import os
import subprocess
import boto3
import uuid
import tempfile
import time
import traceback
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Path, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional, Any, Callable, TypeVar
from supabase import create_client, Client
try:
    from supabase import ClientOptions
except Exception:
    try:
        from postgrest import ClientOptions  # type: ignore
    except Exception:
        ClientOptions = None  # type: ignore

T = TypeVar("T")

# NEW: Load the .env file explicitly!
load_dotenv()


class Settings(BaseSettings):
    R2_ACCESS_KEY_ID: str
    R2_SECRET_ACCESS_KEY: str
    R2_BUCKET_NAME: str
    R2_ENDPOINT_URL: str
    R2_PUBLIC_URL: str
    SUPABASE_URL: str
    SUPABASE_SERVICE_ROLE_KEY: str
    
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )

settings = Settings()

# Debug prints for env vars
print("=== DEBUG: Loading Supabase Credentials ===")
print(f"SUPABASE_URL from os.getenv: {os.getenv('SUPABASE_URL')}")
print(f"SUPABASE_SERVICE_ROLE_KEY from os.getenv (first 50 chars): {os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')[:50]}...")
print(f"SUPABASE_URL from settings: {settings.SUPABASE_URL}")
print(f"SUPABASE_SERVICE_ROLE_KEY from settings (first 50 chars): {settings.SUPABASE_SERVICE_ROLE_KEY[:50]}...")
print("============================================")

# Initialize Supabase client
SUPABASE_URL = os.getenv("SUPABASE_URL") or settings.SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or settings.SUPABASE_SERVICE_ROLE_KEY


def _build_supabase_client() -> Client:
    """Cria um cliente Supabase novo, forcando HTTP/1.1 para evitar erros
    intermitentes de HTTP/2 `RemoteProtocolError / ConnectionTerminated`."""
    kwargs: dict[str, Any] = {}
    if ClientOptions is not None:
        try:
            try:
                kwargs["options"] = ClientOptions(http2=False)
            except TypeError:
                # ClientOptions pode nao aceitar `http2` diretamente nessa versao
                try:
                    import httpx as _httpx  # type: ignore
                    # Cria sessao customizada forcando HTTP/1.1
                    transport = _httpx.HTTPTransport(http2=False)
                    session = _httpx.Client(transport=transport, timeout=60.0)
                    kwargs["options"] = ClientOptions()
                    kwargs["_httpx_client"] = session  # fallback; nem toda versao usa
                except Exception:
                    pass
        except Exception:
            pass
    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, **{k: v for k, v in kwargs.items() if k != "_httpx_client"})
    try:
        # Fallback universal: se a biblioteca expor `postgrest_client` ou .session,
        # tentamos injetar HTTP/1.1 via monkey-patch de options se o ClientOptions nao pegou.
        import httpx as _httpx
        for attr in ("postgrest_client", "storage_client", "auth_client"):
            sub = getattr(client, attr, None)
            if sub is None:
                continue
            sess = getattr(sub, "session", None) or getattr(sub, "_session", None)
            if isinstance(sess, _httpx.Client) and not getattr(sess, "_force_http1_patched", False):
                try:
                    # Substitui o pool por um novo sem http2 (HTTP/1.1 forçado)
                    sess._transport = _httpx.HTTPTransport(http2=False)
                    sess._force_http1_patched = True  # type: ignore[attr-defined]
                except Exception:
                    pass
    except Exception:
        pass
    return client


supabase_admin: Client = _build_supabase_client()


def _is_transport_or_protocol_error(e: Exception) -> bool:
    """Retorna True se o erro veio de camada HTTP transport/protocolo (falha transitoria de conexao/retry seguro)."""
    name = type(e).__name__
    msg = str(e).lower()
    if name in ("RemoteProtocolError", "ProtocolError", "ConnectError", "ReadError", "WriteError", "ConnectionError", "TransportError"):
        return True
    if "connectionterminated" in msg or "remote protocol error" in msg or "connection reset" in msg or "broken pipe" in msg:
        return True
    try:
        import httpx as _httpx
        if isinstance(e, (_httpx.TransportError, _httpx.ProtocolError, _httpx.RemoteProtocolError, _httpx.ConnectError, _httpx.ReadError, _httpx.WriteError, _httpx.LocalProtocolError)):
            return True
    except Exception:
        pass
    try:
        import httpcore as _hc
        if isinstance(e, (_hc.RemoteProtocolError, _hc.ProtocolError, _hc.ConnectionNotAvailable, _hc.ConnectError, _hc.ReadError, _hc.WriteError)):
            return True
    except Exception:
        pass
    return False


def _is_pgrst_missing_column_error(e: Exception, column_name: Optional[str] = None) -> bool:
    """Retorna True se o erro foi PGRST204 (schema cache nao encontra a coluna)."""
    s = str(e)
    lower = s.lower()
    if "pgrst204" in s or "could not find the" in lower or "column of" in lower and "schema cache" in lower:
        if column_name is None or (column_name.lower() in lower):
            return True
    return False


# -----------------------------------------------------------------
# Controle de cache schema do PostgREST para coluna `status` em student_lessons:
#  None = nunca testamos
#  True = coluna existe confirmado (1 request com status passou)
#  False = coluna NAO existe (confirmado apos reload schema + retente)
# Usamos isso para nao ficar caindo em fallback de PGRST204 eternamente quando
# o usuario acabou de rodar ALTER TABLE e o cache do PostgREST ainda nao atualizou.
# -----------------------------------------------------------------
_sl_status_column_probed: Optional[bool] = None

def _try_reload_pgrst_schema(attempt_rpc: bool = True) -> bool:
    """Tenta disparar NOTIFY pgrst, 'reload schema' via RPC util_exec_sql.
    Retorna True se a RPC foi chamada com sucesso (o schema sera reloadado em ~500ms)."""
    global supabase_admin
    if not attempt_rpc:
        return False
    try:
        def _run(c: Client):
            return c.rpc("util_exec_sql", {"sql_text": "NOTIFY pgrst, 'reload schema';"}).execute()
        _ = execute_supabase_with_retry(_run, max_attempts=1, operation_label="reload-pgrst-schema")
        time.sleep(0.55)
        print("[schema-cache] 🚀 NOTIFY pgrst, reload schema enviado via RPC util_exec_sql.")
        return True
    except Exception as rpc_missing:
        # RPC util_exec_sql nao existe (esperado se usuario ainda nao criou).
        msg = str(rpc_missing).lower()
        if ("could not find" in msg or "function" in msg and ("not exist" in msg or "does not exist" in msg)):
            print("[schema-cache] ℹ️ RPC util_exec_sql nao criada ainda. Cache PGRST pode levar alguns minutos para recarregar sozinho.")
        else:
            print(f"[schema-cache] ℹ️ Falhou reload schema (ok): {type(rpc_missing).__name__}: {str(rpc_missing)[:220]}")
        return False


def _upsert_student_lessons_status_safely(
    *,
    row: dict,
    fallback_row_no_status: dict,
    label: str,
    on_conflict: str = "student_id,lesson_id",
    use_update_where: Optional[dict] = None,
) -> tuple:
    """Wrapper SEGURO para student_lessons: tenta gravar COM a coluna `status`.
    Se falhar com PGRST204 pela PRIMEIRA vez: dispara NOTIFY reload schema,
    dorme 0.6s, e RETENTA a query com status de novo. Se ainda falhar PGRST204:
    executa fallback SEM a coluna status. Marca flag global para proximas requests.

    Args:
        row: upsert/update payload COM a coluna status
        fallback_row_no_status: payload SEM a coluna status (fallback definitivo)
        label: label do log
        on_conflict: on_conflict string (usado em UPSERT, None = UPDATE)
        use_update_where: se passado {k:v}, faz .update().eq(k,v) ao inves de .upsert()

    Returns:
        (result_object, used_fallback: bool, status_column_exists_now: bool)
    """
    global _sl_status_column_probed
    used_fallback = False
    # Se JA TEMOS confirmacao de que coluna NAO existe (False): pula direto para fallback
    if _sl_status_column_probed is False:
        try:
            if use_update_where is not None:
                def _fb_upd(c: Client):
                    q = c.table('student_lessons').update(fallback_row_no_status)
                    for k, v in use_update_where.items():
                        q = q.eq(k, v)
                    return q.execute()
                res = execute_supabase_with_retry(_fb_upd, operation_label=f"{label}:fallback")
            else:
                def _fb_upsert(c: Client):
                    return c.table('student_lessons').upsert(fallback_row_no_status, on_conflict=on_conflict).execute()
                res = execute_supabase_with_retry(_fb_upsert, operation_label=f"{label}:fallback")
            return res, True, False
        except Exception:
            # fallback falhou: deixa erro subir
            raise

    first_pgrst_happened = False
    # TENTATIVA 1: com status (forçado)
    try:
        if use_update_where is not None:
            def _run1(c: Client):
                q = c.table('student_lessons').update(row)
                for k, v in use_update_where.items():
                    q = q.eq(k, v)
                return q.execute()
            r1 = execute_supabase_with_retry(_run1, operation_label=label)
        else:
            def _run1(c: Client):
                return c.table('student_lessons').upsert(row, on_conflict=on_conflict).execute()
            r1 = execute_supabase_with_retry(_run1, operation_label=label)
        # SUCESSO → marca que coluna EXISTE
        _sl_status_column_probed = True
        return r1, False, True
    except Exception as e1:
        if not _is_pgrst_missing_column_error(e1, "status"):
            # NÃO é PGRST204 → erro real
            raise
        # PGRST204 detectado
        first_pgrst_happened = True

    # CHEGOU AQUI → PGRST204 na tentativa 1.
    # Se nunca tentamos reload schema, tentamos agora e retentamos 1 vez
    if _sl_status_column_probed is None and first_pgrst_happened:
        print(f"[schema-cache] 🧪 {label}: PGRST204 detectado. Tentando reload schema...")
        _try_reload_pgrst_schema()
        try:
            if use_update_where is not None:
                def _run2(c: Client):
                    q = c.table('student_lessons').update(row)
                    for k, v in use_update_where.items():
                        q = q.eq(k, v)
                    return q.execute()
                r2 = execute_supabase_with_retry(_run2, operation_label=f"{label}:post-reload")
            else:
                def _run2(c: Client):
                    return c.table('student_lessons').upsert(row, on_conflict=on_conflict).execute()
                r2 = execute_supabase_with_retry(_run2, operation_label=f"{label}:post-reload")
            _sl_status_column_probed = True
            print(f"[schema-cache] ✅ {label}: Coluna status apareceu apos reload (cache invalidado!).")
            return r2, False, True
        except Exception as e2:
            if not _is_pgrst_missing_column_error(e2, "status"):
                raise
            print(f"[schema-cache] ℹ️ {label}: Ainda PGRST204 apos reload. Coluna realmente nao existe → usando fallback.")
            _sl_status_column_probed = False
            used_fallback = True

    # Fallback definitivo (sem coluna status)
    if use_update_where is not None:
        def _fb_final_upd(c: Client):
            q = c.table('student_lessons').update(fallback_row_no_status)
            for k, v in use_update_where.items():
                q = q.eq(k, v)
            return q.execute()
        rf = execute_supabase_with_retry(_fb_final_upd, operation_label=f"{label}:fallback")
    else:
        def _fb_final_upsert(c: Client):
            return c.table('student_lessons').upsert(fallback_row_no_status, on_conflict=on_conflict).execute()
        rf = execute_supabase_with_retry(_fb_final_upsert, operation_label=f"{label}:fallback")
    return rf, used_fallback, (_sl_status_column_probed is True)


def execute_supabase_with_retry(
    action: Callable[[Client], T],
    *,
    max_attempts: int = 4,
    base_backoff: float = 0.18,
    operation_label: str = "",
) -> T:
    """Executa uma acao no cliente Supabase com retry robusto:
    - 4 tentativas com backoff exponencial (0.18s, 0.36s, 0.72s, 1.08s)
    - Em falhas de HTTP transport/protocolo: RECRIA o cliente do zero (descarta pool de conexao HTTP/2 travada)
    - Loga detalhes de cada tentativa falha.
    """
    global supabase_admin
    last_exc: Optional[BaseException] = None
    for attempt in range(1, max_attempts + 1):
        client = supabase_admin
        try:
            result = action(client)
            if attempt > 1 and operation_label:
                print(f"[supabase-retry] {operation_label} OK na tentativa {attempt}.")
            return result
        except Exception as e:
            last_exc = e
            is_transient = _is_transport_or_protocol_error(e)
            if attempt >= max_attempts or not is_transient:
                # Nao retenta: ou esgotou tentativas, ou erro nao e transitorio
                raise
            # Regenera cliente para limpar pool HTTP com conexoes mortas
            try:
                supabase_admin = _build_supabase_client()
                print(f"[supabase-retry] Cliente Supabase regenerado (tentativa {attempt}/{max_attempts}). label={operation_label} erro={type(e).__name__}: {str(e)[:200]}")
            except Exception as rebuild_e:
                print(f"[supabase-retry] Nao foi possivel regenerar cliente: {rebuild_e}")
            sleep_s = base_backoff * (2 ** (attempt - 1))
            sleep_s = min(sleep_s, 1.2)
            time.sleep(sleep_s)
    # Raramente cai aqui: apenas se ultimo raise anterior nao acontecer
    if last_exc is not None:
        raise last_exc
    raise RuntimeError(f"execute_supabase_with_retry falhou silenciosamente. label={operation_label}")


app = FastAPI()


def _is_trusted_origin(origin: Optional[str]) -> bool:
    if not origin:
        return False
    o = origin.strip().lower()
    if o == "null":
        # iOS Safari homescreen, WKWebView, apps mobile, iframe sandbox: enviam "null" como origem.
        # Como autenticamos via Bearer e nao so por cookie cross-origin, consideramos segura.
        return True
    if o.startswith("http://localhost") or o.startswith("http://127.0.0.1"):
        return True
    if o.startswith("http://192.168.") or o.startswith("http://10.") or o.startswith("http://172."):
        return True
    if o.endswith(".vercel.app") or o == "https://devolva-se.vercel.app":
        return True
    if o.endswith(".onrender.com") or o == "https://devolvase.onrender.com":
        return True
    if ".ngrok-free.app" in o or ".ngrok.app" in o or ".ngrok.io" in o:
        return True
    if o.startswith("capacitor://") or o.startswith("ionic://") or o.startswith("file://"):
        return True
    frontend_url = (os.getenv("FRONTEND_URL") or "").strip().lower()
    if frontend_url and frontend_url == o:
        return True
    extra = [x.strip().lower() for x in (os.getenv("CORS_EXTRA_ORIGINS") or "").split(",") if x.strip()]
    if o in extra:
        return True
    return False


@app.middleware("http")
async def cors_and_security_middleware(request: Request, call_next):
    origin = request.headers.get("origin")
    # Resposta para preflight OPTIONS (fallback, antes do CORSMiddleware atuar)
    if request.method == "OPTIONS":
        trusted = _is_trusted_origin(origin)
        allowed_origin = origin if trusted else "*"
        # Importante: browsers BLOQUEIAM resposta CORS quando Allow-Origin eh "*" e
        # Allow-Credentials eh "true". So enviamos credentials=true para origens dinamicas.
        allow_credentials = "true" if (trusted and allowed_origin != "*") else "false"
        headers = {
            "Access-Control-Allow-Origin": allowed_origin,
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Origin, X-Requested-With, apikey, x-client-info, x-application-secret, Range",
            "Access-Control-Expose-Headers": "Content-Length, Content-Type, Content-Range, ETag, Last-Modified",
            "Access-Control-Allow-Credentials": allow_credentials,
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin",
        }
        return JSONResponse(status_code=204, content=None, headers=headers)

    try:
        response = await call_next(request)
    except HTTPException as he:
        detail = he.detail if isinstance(he.detail, (str, dict, list)) else str(he.detail)
        response = JSONResponse(status_code=he.status_code, content={"detail": detail})
    except Exception as e:
        response = JSONResponse(status_code=500, content={"detail": str(e)})

    # Aplica headers de segurança e CORS dinâmicos em todas as respostas
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer-when-downgrade"
    response.headers["Vary"] = "Origin, Accept-Encoding"
    trusted = _is_trusted_origin(origin)
    if trusted:
        response.headers["Access-Control-Allow-Origin"] = origin or "*"
        # Como acima: Allow-Credentials=true apenas se Allow-Origin NAO for wildcard.
        if origin and origin != "*":
            response.headers["Access-Control-Allow-Credentials"] = "true"
    else:
        # Fallback publico (uploads de video podem ser acessados via player direto)
        response.headers["Access-Control-Allow-Origin"] = "*"

    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, Accept, Origin, X-Requested-With, apikey, x-client-info, x-application-secret, Range"
    response.headers["Access-Control-Expose-Headers"] = "Content-Length, Content-Type, Content-Range, ETag, Last-Modified"
    response.headers["Access-Control-Max-Age"] = "86400"
    return response


# CORS configuration (camada secundaria — o middleware acima ja resolve preflight/dinamico,
#  mas manter ele para manter Starlette/FastAPI path normalizacao e compatibilidade com uploads grandes)
frontend_url = os.getenv("FRONTEND_URL", "").strip()
extra_origins = [o.strip() for o in os.getenv("CORS_EXTRA_ORIGINS", "").split(",") if o.strip()]
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://192.168.1.12:3000",
    "https://devolva-se.vercel.app",
]
if frontend_url and frontend_url not in origins:
    origins.append(frontend_url)
for origin in extra_origins:
    if origin not in origins:
        origins.append(origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https://.*\.(vercel\.app|onrender\.com|ngrok\.app|ngrok-free\.app|ngrok\.io)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
)

BOOTSTRAP_SQL = """
------------------------------------------------------------
 DEVOLVASE - BOOTSTRAP OBRIGATÓRIO (execute 1 vez no Supabase
 SQL Editor: https://supabase.com/dashboard/project/_/sql/new
------------------------------------------------------------
-- 1) Garante que a coluna `status` exista em `student_lessons`
ALTER TABLE public.student_lessons
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'unlocked';

-- 2) Garante que a coluna `updated_at` exista (para trigger realtime)
ALTER TABLE public.student_lessons
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3) Backfill status baseado nas colunas booleanas is_locked / is_completed (se existirem dados antigos)
UPDATE public.student_lessons
   SET status = CASE
                  WHEN is_completed = TRUE THEN 'approved'
                  WHEN is_locked    = TRUE THEN 'locked'
                  ELSE 'unlocked'
                END
 WHERE status IS NULL OR status = '';

-- 4) Trigger de auto-update updated_at a cada UPDATE (se a funcao moddatetime existir — vem por padrão no Supabase)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'moddatetime') THEN
    DROP TRIGGER IF EXISTS handle_updated_at ON public.student_lessons;
    CREATE TRIGGER handle_updated_at
      BEFORE UPDATE ON public.student_lessons
      FOR EACH ROW
      EXECUTE FUNCTION moddatetime('updated_at');
  END IF;
END $$;

-- 5) Garante que a coluna `phone` exista em `profiles`
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone VARCHAR(30);

-- 6) Forca recarga imediata do cache de schema do PostgREST
--    (evita PGRST204 "column not found in schema cache" por alguns minutos)
NOTIFY pgrst, 'reload schema';

------------------------------------------------------------
-- OPCIONAL: cria funcao RPC para backend recarregar schema
-- automaticamente (necessaria para POST /admin/reload-schema):
--   CREATE OR REPLACE FUNCTION public.util_exec_sql(sql_text TEXT)
--   RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
--   AS $$ BEGIN EXECUTE sql_text; RETURN 'OK';
--        EXCEPTION WHEN OTHERS THEN RETURN 'ERRO: ' || SQLERRM; END; $$;
------------------------------------------------------------
 FIM DO SCRIPT
------------------------------------------------------------
"""

_schema_bootstrapped_flag = {"done": False}

@app.on_event("startup")
async def on_app_startup():
    """Loga instruções SQL e tenta bootstrap se possível via RPC util_bootstrap (se existir)."""
    global _schema_bootstrapped_flag
    try:
        print("\n" + "=" * 72)
        print("[schema-bootstrap] Supabase student_lessons STATUS e UPDATED_AT:")
        print("=" * 72)
        print("ATENCAO: Para 100% de sincronia, COPIE o SQL abaixo e EXECUTE 1 vez")
        print("         no Supabase SQL Editor (login app.supabase.com -> seu projeto -> SQL Editor):")
        print("-" * 72)
        try:
            for line in BOOTSTRAP_SQL.strip().splitlines():
                if not line:
                    print("")
                else:
                    print(f"  {line}")
        except Exception:
            print(BOOTSTRAP_SQL)
        print("=" * 72)
        print("[schema-bootstrap] Alternativa: POST /admin/bootstrap-schema { \"run\": true } (BEARER ADMIN)")
        print("                   se voce tiver criado a RPC util_exec_sql() no painel SQL.")
        print("[schema-bootstrap] Ou para SOLO recarregar cache PostgREST: POST /admin/reload-schema { \"force\": true }")
        print("=" * 72 + "\n")
    except Exception as startup_log_e:
        print(f"[schema-bootstrap] log startup falhou: {startup_log_e}")

    # Tenta rodar via RPC util_exec_sql se ela existir (1 tentativa, silenciosa)
    if not _schema_bootstrapped_flag.get("done"):
        try:
            def _try_rpc(c: Client):
                return c.rpc("util_exec_sql", {"sql_text": BOOTSTRAP_SQL}).execute()
            result = execute_supabase_with_retry(_try_rpc, max_attempts=1, operation_label="startup:rpc-bootstrap")
            if result:
                _schema_bootstrapped_flag["done"] = True
                print("[schema-bootstrap] ✅ RPC util_exec_sql encontrou e bootstrap executou OK.")
        except Exception as rpc_missing_e:
            # Esperado: RPC util_exec_sql não existe → segue normalmente, usuário roda no SQL Editor.
            if "could not find" in str(rpc_missing_e).lower() or "function" in str(rpc_missing_e).lower() and "not" in str(rpc_missing_e).lower():
                print("[schema-bootstrap] ℹ️ RPC util_exec_sql nao existe (esperado). Use o SQL Editor manualmente.")
            else:
                print(f"[schema-bootstrap] ℹ️ Tentativa automatica de RPC finalizada (ok se falhou): {type(rpc_missing_e).__name__}")
    _schema_bootstrapped_flag["done"] = True


def get_ffmpeg_path():
    # Tenta múltiplos caminhos para o FFmpeg
    ffmpeg_paths = [
        'ffmpeg',
        r'C:\ffmpeg\ffmpeg.exe',
        r'C:\Program Files\FFmpeg\bin\ffmpeg.exe',
        r'C:\Program Files (x86)\FFmpeg\bin\ffmpeg.exe',
    ]
    for path in ffmpeg_paths:
        try:
            subprocess.run([path, '-version'], capture_output=True, check=True)
            return path
        except:
            continue
    raise Exception("FFmpeg não encontrado! Instale o FFmpeg e adicione ao PATH ou coloque em C:\\ffmpeg\\ffmpeg.exe")


def get_ffprobe_path():
    # Procura ffprobe nos mesmos locais do ffmpeg (costumam estar juntos)
    ffprobe_paths = [
        'ffprobe',
        r'C:\ffmpeg\ffprobe.exe',
        r'C:\Program Files\FFmpeg\bin\ffprobe.exe',
        r'C:\Program Files (x86)\FFmpeg\bin\ffprobe.exe',
    ]
    for path in ffprobe_paths:
        try:
            subprocess.run([path, '-version'], capture_output=True, check=True)
            return path
        except:
            continue
    return None  # None = fallback, pula validacao de duracao sem quebrar o fluxo


def probe_video_duration(file_path: str) -> Optional[float]:
    """Retorna duracao em segundos, ou None se nao for possivel medir."""
    try:
        ffprobe_path = get_ffprobe_path()
        if not ffprobe_path:
            print("[UPLOAD-EXERCISE] WARN: ffprobe nao encontrado, pulando validacao de duracao")
            return None
        result = subprocess.run(
            [
                ffprobe_path, '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                file_path
            ],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            print(f"[UPLOAD-EXERCISE] WARN: ffprobe retornou erro: {result.stderr[:200]}")
            return None
        out = (result.stdout or '').strip()
        if not out:
            return None
        return float(out)
    except Exception as e:
        print(f"[UPLOAD-EXERCISE] WARN: erro ao medir duracao (continuando): {e}")
        return None

class StudentCreate(BaseModel):
    full_name: str
    username: str
    password: str
    instruments: list[str]
    phone: Optional[str] = None

class StudentUpdate(BaseModel):
    full_name: Optional[str] = None
    instruments: Optional[list[str]] = None
    phone: Optional[str] = None

class InstrumentCreate(BaseModel):
    name: str

class InstrumentUpdate(BaseModel):
    name: str

class ModuleCreate(BaseModel):
    instrument_id: str
    title: str
    description: Optional[str] = None
    long_description: Optional[str] = None
    objectives: Optional[str] = None
    estimated_hours: Optional[int] = None

class ModuleUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    long_description: Optional[str] = None
    objectives: Optional[str] = None
    estimated_hours: Optional[int] = None


class ToggleLessonLockRequest(BaseModel):
    student_id: str
    lesson_id: str
    unlocked: bool

class ApproveLessonRequest(BaseModel):
    student_id: str
    lesson_id: str

class LessonFeedbackRequest(BaseModel):
    teacher_id: str
    student_id: str
    lesson_id: str
    lesson_title: Optional[str] = None
    module_title: Optional[str] = None
    exercise_video_url: Optional[str] = None
    feedback_text: str


# =====================================================================
# BIBLIOTECA DE AULAS — Models Pydantic (aditivos, zero regressão)
# =====================================================================
class LessonLibraryUpdate(BaseModel):
    """Atualiza campos da BIBLIOTECA numa lesson (campos novos da migration BIB-A2)."""
    title: Optional[str] = None
    description: Optional[str] = None
    long_description: Optional[str] = None
    objectives: Optional[str] = None
    difficulty: Optional[str] = None
    sheet_pdf_url: Optional[str] = None
    sheet_pdf_name: Optional[str] = None
    backing_track_url: Optional[str] = None
    backing_track_name: Optional[str] = None


# =====================================================================
# FASE 2 - PRONTUÁRIO / ANOTAÇÕES POR INSTRUMENTO (Models Pydantic)
# =====================================================================
class EnrollmentUpsertRequest(BaseModel):
    """Salva/atualiza o prontuário (posição atual) de 1 aluno em 1 instrumento."""
    student_id: str
    instrument_id: str
    current_module_id: Optional[str] = None
    last_completed_lesson_id: Optional[str] = None
    position_note: Optional[str] = None

class InstructorNoteCreateRequest(BaseModel):
    """Anotação nova do professor no prontuário."""
    student_id: str
    instrument_id: str
    instructor_id: str
    body: str
    title: Optional[str] = None

class InstructorNoteUpdateRequest(BaseModel):
    """Edição de anotação existente."""
    body: Optional[str] = None
    title: Optional[str] = None

# =====================================================================
# FASE 3 - DIÁRIO DE TREINO (Practice Logs) - Models Pydantic
# =====================================================================
class PracticeLogCreateRequest(BaseModel):
    """Registro de treino do aluno."""
    student_id: str
    duration_minutes: int
    notes: Optional[str] = None
    practice_date: Optional[str] = None

# =====================================================================
# FASE 4 - NOTIFICAÇÕES EM-APP (Sininho) - Models Pydantic
# =====================================================================
class NotificationMarkReadRequest(BaseModel):
    """Marca 1 notificação como lida."""
    notification_id: str

def _try_create_notification(
    *,
    user_id: str,
    title: str,
    message: str,
    type: str = 'general',
    action_url: Optional[str] = None,
    related_student_id: Optional[str] = None,
    related_lesson_id: Optional[str] = None,
    _label_suffix: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """Wrapper BEST-EFFORT para criar notificação.
    NUNCA quebra o fluxo core — se tabela notifications não existir
    ou qualquer erro acontecer, apenas loga e retorna None.
    """
    try:
        if not user_id:
            return None
        payload: dict[str, Any] = {
            "user_id": user_id,
            "title": title[:220] if title else title,
            "message": message[:2000] if message else message,
            "type": (type or "general")[:40],
        }
        if action_url: payload["action_url"] = action_url
        if related_student_id: payload["related_student_id"] = related_student_id
        if related_lesson_id: payload["related_lesson_id"] = related_lesson_id

        label = f"notif-create({(_label_suffix or type)[:24]},{user_id[:8]}..)"
        def _insert(c: Client):
            return c.table('notifications').insert(payload).select('*').execute()
        result = execute_supabase_with_retry(_insert, operation_label=label)
        row = (result.data and len(result.data) > 0) or None
        if row: return dict(result.data[0])
        return None
    except Exception as e:
        # Silencioso: qualquer erro aqui NÃO pode quebrar o fluxo core
        # (ex: migration não aplicada, RLS, coluna faltando etc.)
        if not _is_table_or_relation_missing_error(e, "notifications"):
            print(f"[notif] WARN: create falhou (ignorado, tipo={type}): {type(e).__name__}: {str(e)[:160]}")
        return None

def _find_teacher_user_id() -> Optional[str]:
    """Busca 1 professor na tabela profiles para enviar notificações (fallback)."""
    try:
        def _sel(c: Client):
            return c.table('profiles').select('id').eq('role', 'teacher').limit(1).execute()
        result = execute_supabase_with_retry(_sel, operation_label="find-teacher-notif")
        rows = result.data or []
        if rows and len(rows) > 0:
            return str(rows[0]["id"])
    except Exception as e:
        print(f"[notif] WARN: busca professor falhou (ignorado): {type(e).__name__}")
    return None

def _is_table_or_relation_missing_error(e: Exception, table_name: Optional[str] = None) -> bool:
    """Detecta erro de relação/tabela não existente (42P01 ou 'relation does not exist').
    Retorna True quando a migration SQL da FASE 1 ainda não foi aplicada neste ambiente
    — nesses casos retornamos 200 com dado vazio ao invés de 500.
    """
    s = str(e).lower()
    # "relation X does not exist" (Postgres 42P01) / "could not find a column from table X"
    # Também detecta quando o PostgREST ainda não conhece a tabela no schema cache.
    markers = [
        "does not exist",
        "relation",
        "42p01",
        "undefined_table",
        "could not find"
    ]
    if not any(m in s for m in markers):
        return False
    if table_name is None:
        return True
    return (table_name.lower() in s) or ("table" in s)


# Modificar rota create_student para usar supabase_admin
@app.post("/admin/create-student")
async def create_student(student: StudentCreate):
    try:
        internal_email = f"{student.username.lower()}@devolvase.app"
        
        # 1. Tenta criar usuario no Auth. Se ja existe -> erro amigavel
        try:
            auth_response = supabase_admin.auth.admin.create_user({
                "email": internal_email,
                "password": student.password,
                "user_metadata": {
                    "full_name": student.full_name,
                    "username": student.username,
                    "role": "student"
                },
                "email_confirm": True
            });
        except Exception as auth_e:
            auth_msg = str(auth_e).lower()
            if 'already registered' in auth_msg or 'already exists' in auth_msg or 'email' in auth_msg and 'exists' in auth_msg:
                raise HTTPException(status_code=409, detail="Este usuario/email ja esta cadastrado")
            raise auth_e
        
        if not auth_response.user:
            raise HTTPException(status_code=400, detail="Erro ao criar usuário no Auth")

        user_id = auth_response.user.id
        instruments_str = ", ".join(student.instruments) if student.instruments else ""
        profile_data = {
            "id": user_id,
            "full_name": student.full_name,
            "role": "student",
            "instrument": instruments_str
        }
        # Trata phone como OPCIONAL: só inclui se veio preenchido
        if student.phone and str(student.phone).strip():
            profile_data["phone"] = student.phone
        
        # Inserir na tabela profiles com tratamento de coluna inexistente
        from concurrent.futures import ThreadPoolExecutor
        import asyncio
        
        def sync_insert_profile():
            try:
                def _do_insert(c: Client):
                    return c.table('profiles').insert(profile_data).execute()
                return execute_supabase_with_retry(_do_insert, operation_label=f"create-student:profile({student.username[:10]})")
            except Exception as profile_err:
                err_msg = str(profile_err).lower()
                if "phone" in profile_data and ('column "phone"' in err_msg or 'phone' in err_msg and 'exist' in err_msg):
                    print(f"[AVISO create-student] Coluna phone nao existe na tabela profiles. Inserindo sem telefone.")
                    fallback = {k: v for k, v in profile_data.items() if k != "phone"}
                    def _do_insert_fallback(c: Client):
                        return c.table('profiles').insert(fallback).execute()
                    return execute_supabase_with_retry(_do_insert_fallback, operation_label=f"create-student:profile:fallback({student.username[:10]})")
                raise profile_err
        
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(ThreadPoolExecutor(), sync_insert_profile)
        print(f"✅ Perfil criado para {student.full_name}: {result}")
        
        return {"status": "success", "user_id": user_id}
        
    except HTTPException as he:
        # Repassa HTTPExceptions (inclui nosso 409 custom) sem alterar
        raise he
    except Exception as e:
        msg = str(e).lower()
        print(f"Erro ao criar aluno: {str(e)}")
        if 'already registered' in msg or 'already exists' in msg or ('email' in msg and 'exists' in msg):
            raise HTTPException(status_code=409, detail="Este e-mail ou usuario ja esta cadastrado")
        if 'duplicate' in msg:
            raise HTTPException(status_code=409, detail="Este usuario ja esta cadastrado")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/admin/students/{student_id}")
async def update_student(student_id: str, student: StudentUpdate):
    try:
        profile_data = {}
        if student.full_name:
            profile_data["full_name"] = student.full_name
        if student.instruments is not None:
            instruments_str = ", ".join(student.instruments)
            profile_data["instrument"] = instruments_str
        if student.phone is not None:
            profile_data["phone"] = student.phone

        def _do_update(c: Client):
            return c.table('profiles').update(profile_data).eq('id', student_id).execute()
        result = execute_supabase_with_retry(_do_update, operation_label=f"update-student({student_id[:8]}..)")
        print(f"✅ Perfil atualizado para aluno {student_id}: {result}")

        return {"status": "success"}

    except Exception as e:
        print(f"Erro ao atualizar aluno: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/admin/students/{student_id}")
async def delete_student(student_id: str):
    try:
        await supabase_admin.auth.admin.delete_user(student_id)

        def _do_delete_profile(c: Client):
            return c.table('profiles').delete().eq('id', student_id).execute()
        execute_supabase_with_retry(_do_delete_profile, operation_label=f"delete-student({student_id[:8]}..)")

        print(f"✅ Aluno {student_id} deletado com sucesso")
        return {"status": "success"}

    except Exception as e:
        print(f"Erro ao deletar aluno: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/toggle-lesson-lock")
async def toggle_lesson_lock(request: ToggleLessonLockRequest):
    try:
        print(f"Iniciando operacao para alternar estado da aula...")
        print(f"   student_id: {request.student_id}")
        print(f"   lesson_id: {request.lesson_id}")
        print(f"   unlocked: {request.unlocked}")
        print(f"   is_locked: {not request.unlocked}")

        new_status = 'unlocked' if request.unlocked else 'locked'
        label = f"toggle-lesson-lock({request.lesson_id[:8]}..,{request.student_id[:8]}..)"

        print("   Executando upsert no Supabase (wrapper cache-safe)...")
        result, used_fallback, status_exists_now = _upsert_student_lessons_status_safely(
            row={
                "student_id": request.student_id,
                "lesson_id": request.lesson_id,
                "is_locked": not request.unlocked,
                "is_completed": False,
                "status": new_status
            },
            fallback_row_no_status={
                "student_id": request.student_id,
                "lesson_id": request.lesson_id,
                "is_locked": not request.unlocked,
                "is_completed": False,
            },
            label=label,
            on_conflict="student_id,lesson_id"
        )
        if used_fallback:
            print(f"   Resultado Supabase (fallback, sem coluna status): {result}")
        else:
            print(f"   Resultado Supabase (COM status, cache_ok={status_exists_now}): {result}")

        print(f"✅ Aula {request.lesson_id} {'liberada' if request.unlocked else 'bloqueada'} para aluno {request.student_id}")

        row = result.data[0] if getattr(result, 'data', None) and len(result.data) > 0 else None
        normalized = None
        if row:
            normalized = dict(row)
            normalized.setdefault("is_locked", (not request.unlocked))
            normalized.setdefault("is_completed", False)
            if not normalized.get("status"):
                if bool(normalized.get("is_completed")):
                    normalized["status"] = "approved"
                elif bool(normalized.get("is_locked")):
                    normalized["status"] = "locked"
                else:
                    normalized["status"] = "unlocked"
        return {
            "status": "success",
            "new_status": new_status,
            "is_locked": (normalized.get("is_locked") if normalized else (not request.unlocked)),
            "is_completed": (normalized.get("is_completed") if normalized else False),
            "status_column_exists": status_exists_now,
            "used_fallback": used_fallback,
            "row": normalized
        }

    except Exception as e:
        print(f"❌ Erro ao alternar estado da aula:")
        print(f"   Tipo de erro: {type(e).__name__}")
        print(f"   Mensagem: {str(e)}")
        print(f"   Stack trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/approve-lesson")
async def approve_lesson(request: ApproveLessonRequest):
    try:
        print(f"✅ Aprovando aula...")
        print(f"   student_id: {request.student_id}")
        print(f"   lesson_id: {request.lesson_id}")
        label = f"approve-lesson({request.lesson_id[:8]}..,{request.student_id[:8]}..)"

        result, used_fallback, status_exists_now = _upsert_student_lessons_status_safely(
            row={
                "student_id": request.student_id,
                "lesson_id": request.lesson_id,
                "is_locked": False,
                "is_completed": True,
                "status": "approved"
            },
            fallback_row_no_status={
                "student_id": request.student_id,
                "lesson_id": request.lesson_id,
                "is_locked": False,
                "is_completed": True
            },
            label=label,
            on_conflict="student_id,lesson_id"
        )
        if used_fallback:
            print(f"   Resultado approve (fallback): {result.data}")
        else:
            print(f"   Resultado approve (cache_ok={status_exists_now}): {result.data}")

        row = result.data[0] if getattr(result, 'data', None) and len(result.data) > 0 else None
        normalized = None
        if row:
            normalized = dict(row)
            normalized.setdefault("is_locked", False)
            normalized.setdefault("is_completed", True)
            if not normalized.get("status"):
                if bool(normalized.get("is_completed")):
                    normalized["status"] = "approved"
                elif bool(normalized.get("is_locked")):
                    normalized["status"] = "locked"
                else:
                    normalized["status"] = "unlocked"

        # =====================================================================
        # GATILHO FASE 4 - Notificação para ALUNO: exercício aprovado
        # =====================================================================
        try:
            lesson_title = None
            try:
                def _sel_lesson2(c: Client):
                    return c.table('lessons').select('title').eq('id', request.lesson_id).limit(1).execute()
                lr2 = execute_supabase_with_retry(_sel_lesson2, operation_label=f"notif-lesson-title-approve({request.lesson_id[:8]}..)")
                if lr2.data and len(lr2.data) > 0:
                    lesson_title = lr2.data[0].get('title')
            except Exception as _e:
                pass
            _try_create_notification(
                user_id=request.student_id,
                title="🎉 Exercício aprovado!",
                message=(f'Seu exercício da aula "{lesson_title}" foi aprovado.' if lesson_title
                         else "Seu exercício foi aprovado. Parabéns! Continue progredindo."),
                type="exercise_approved",
                related_student_id=request.student_id,
                related_lesson_id=request.lesson_id,
                _label_suffix="exercise-approved",
            )
        except Exception as _ne:
            print(f"[notif] WARN: gatilho approve-lesson falhou (ignorado): {type(_ne).__name__}: {str(_ne)[:120]}")

        return {
            "status": "success",
            "new_status": "approved",
            "is_locked": (normalized.get("is_locked") if normalized else False),
            "is_completed": (normalized.get("is_completed") if normalized else True),
            "status_column_exists": status_exists_now,
            "used_fallback": used_fallback,
            "row": normalized
        }
    except Exception as e:
        print(f"ERRO approve-lesson: {e}")
        print(f"Stack trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/bootstrap-schema")
async def bootstrap_schema_endpoint(payload: Optional[dict] = None):
    """Executa o bootstrap do schema (coluna status/updated_at) se tiver permissao.
    Como o PostgREST NAO executa DDL (ALTER TABLE), precisamos de uma funcao SQL SECURITY DEFINER
    chamada `util_exec_sql(sql_text TEXT)` criada uma vez no painel SQL. Se ela nao existir,
    retornamos o SQL completo para colar manualmente no SQL Editor.
    
    Formato RPC util_exec_sql esperado (cole este bloco no SQL Editor 1 vez):
    
        CREATE OR REPLACE FUNCTION public.util_exec_sql(sql_text TEXT)
        RETURNS TEXT
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public
        AS $$
        BEGIN
          EXECUTE sql_text;
          RETURN 'OK';
        EXCEPTION WHEN OTHERS THEN
          RETURN 'ERRO: ' || SQLERRM;
        END;
        $$;
    
    Depois: POST /admin/bootstrap-schema { "run": true }
    """
    req_run = bool(payload and payload.get("run"))
    payload_msg = {"sql": BOOTSTRAP_SQL, "run_requested": req_run, "rpc_used": False, "rpc_result": None}
    if req_run:
        try:
            def _run_rpc(c: Client):
                return c.rpc("util_exec_sql", {"sql_text": BOOTSTRAP_SQL}).execute()
            res = execute_supabase_with_retry(_run_rpc, operation_label="bootstrap-schema:rpc")
            payload_msg["rpc_used"] = True
            payload_msg["rpc_result"] = getattr(res, "data", None)
            _schema_bootstrapped_flag["done"] = True
        except Exception as rpc_e:
            payload_msg["rpc_error"] = {
                "type": type(rpc_e).__name__,
                "message": str(rpc_e)[:500],
                "hint": "Crie a funcao RPC public.util_exec_sql(sql_text TEXT) no SQL Editor primeiro (veja docstring)."
            }
    return JSONResponse(status_code=200, content=payload_msg)


class ReloadSchemaRequest(BaseModel):
    force: Optional[bool] = False
    also_reset_probe_flag: Optional[bool] = True

@app.post("/admin/reload-schema")
async def reload_schema(req: Optional[ReloadSchemaRequest] = None):
    """Dispara NOTIFY pgrst, 'reload schema' para invalidar o cache do PostgREST.
    Ideal para usar logo apos rodar um ALTER TABLE no Supabase SQL Editor (sem esperar timeout do cache).
    """
    global _sl_status_column_probed
    force = bool(req and req.force)
    reset_probe = bool((req is None) or req.also_reset_probe_flag is not False)
    if reset_probe:
        _sl_status_column_probed = None
        print("[schema-cache] 🔄 Flag _sl_status_column_probed resetada para None (vai re-detectar na proxima request).")
    ok = _try_reload_pgrst_schema(attempt_rpc=True)
    if not ok and force:
        print("[schema-cache] ⚠️ Falhou RPC de reload. Tentando sleep 1.2s como fallback de espera de timeout natural do PostgREST...")
        time.sleep(1.2)
    return JSONResponse(status_code=200, content={
        "ok": ok,
        "probe_flag_reset": reset_probe,
        "status_column_probed_now": _sl_status_column_probed,
        "hint": "Se ok=False: crie a RPC public.util_exec_sql(sql_text TEXT) no SQL Editor (BOOTSTRAP_SQL acima tem o exemplo). O cache PostgREST tambem recarrega naturalmente em alguns minutos."
    })


# =====================================================================
# FASE 2 - ENDPOINTS DO PRONTUÁRIO POR INSTRUMENTO
# NÃO TOCA em student_lessons, exercises ou realtime.
# Todas as operações usam as tabelas NOVAS: student_enrollments + student_instructor_notes
# =====================================================================

@app.get("/admin/enrollments/{student_id}/{instrument_id}")
async def get_enrollment(student_id: str, instrument_id: str):
    """Retorna o prontuário (posição atual) de 1 aluno em 1 instrumento.
    Se ainda não existe, retorna { enrollment: None } para o frontend criar em branco.
    Não falha 500 se a tabela ainda não existe no ambiente.
    """
    try:
        label = f"get-enrollment({student_id[:8]}..,{instrument_id[:8]}..)"
        def _q(c: Client):
            return (c.table('student_enrollments')
                    .select("id,student_id,instrument_id,current_module_id,last_completed_lesson_id,position_note,created_at,updated_at")
                    .eq("student_id", student_id)
                    .eq("instrument_id", instrument_id)
                    .maybe_single()
                    .execute())
        res = execute_supabase_with_retry(_q, operation_label=label)
        row = None
        if getattr(res, "data", None) is not None:
            row = res.data
        return {
            "ok": True,
            "enrollment": row,
            "table_exists": True
        }
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "student_enrollments"):
            return {
                "ok": True,
                "enrollment": None,
                "table_exists": False,
                "hint": "Ainda não executou a migration FASE 1 neste ambiente. Rodar SQL /supabase/migrations/20260816120000_add_pedagogical_tables.sql"
            }
        print(f"[prontuario] ERRO get_enrollment: {type(e).__name__} {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/enrollments")
async def upsert_enrollment(req: EnrollmentUpsertRequest):
    """Cria ou atualiza (upsert pela unique student+instrument) o prontuário."""
    try:
        label = f"upsert-enrollment({req.student_id[:8]}..,{req.instrument_id[:8]}..)"
        payload = {
            "student_id": req.student_id,
            "instrument_id": req.instrument_id,
            "current_module_id": req.current_module_id,
            "last_completed_lesson_id": req.last_completed_lesson_id,
            "position_note": (req.position_note.strip() if req.position_note else None)
        }
        def _run(c: Client):
            return (c.table('student_enrollments')
                    .upsert(payload, on_conflict="student_id,instrument_id")
                    .select("id,student_id,instrument_id,current_module_id,last_completed_lesson_id,position_note,created_at,updated_at")
                    .execute())
        res = execute_supabase_with_retry(_run, operation_label=label)
        row = (res.data[0] if getattr(res, "data", None) and len(res.data) else None)
        return {"ok": True, "enrollment": row}
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "student_enrollments"):
            raise HTTPException(status_code=400, detail={
                "code": "TABLE_MISSING",
                "table": "student_enrollments",
                "message": "Migration FASE 1 ainda nao aplicada neste ambiente. Rode o SQL no painel."
            })
        print(f"[prontuario] ERRO upsert_enrollment: {type(e).__name__} {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/admin/notes/{student_id}/{instrument_id}")
async def list_instructor_notes(student_id: str, instrument_id: str):
    """Histórico de anotações do professor no par (aluno, instrumento), + recente primeiro."""
    try:
        label = f"list-notes({student_id[:8]}..,{instrument_id[:8]}..)"
        def _q(c: Client):
            return (c.table('student_instructor_notes')
                    .select("id,student_id,instrument_id,instructor_id,title,body,created_at,updated_at,profiles:profiles!instructor_id(full_name,username)")
                    .eq("student_id", student_id)
                    .eq("instrument_id", instrument_id)
                    .order("created_at", desc=True)
                    .limit(200)
                    .execute())
        res = execute_supabase_with_retry(_q, operation_label=label)
        rows = (res.data if getattr(res, "data", None) else [])
        return {"ok": True, "notes": rows, "count": len(rows)}
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "student_instructor_notes"):
            return {"ok": True, "notes": [], "count": 0, "table_exists": False}
        print(f"[prontuario] ERRO list_notes: {type(e).__name__} {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/notes")
async def create_instructor_note(req: InstructorNoteCreateRequest):
    """Adiciona uma nova anotação ao histórico (append-only)."""
    if not req.body or not req.body.strip():
        raise HTTPException(status_code=422, detail="body (texto da anotacao) obrigatorio")
    try:
        label = f"create-note({req.student_id[:8]}..,{req.instrument_id[:8]}..)"
        payload = {
            "student_id": req.student_id,
            "instrument_id": req.instrument_id,
            "instructor_id": req.instructor_id,
            "title": (req.title.strip() if req.title else None),
            "body": req.body.strip()
        }
        def _ins(c: Client):
            return (c.table('student_instructor_notes')
                    .insert(payload)
                    .select("id,student_id,instrument_id,instructor_id,title,body,created_at,updated_at")
                    .execute())
        res = execute_supabase_with_retry(_ins, operation_label=label)
        row = (res.data[0] if getattr(res, "data", None) and len(res.data) else None)
        return {"ok": True, "note": row}
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "student_instructor_notes"):
            raise HTTPException(status_code=400, detail={
                "code": "TABLE_MISSING", "table": "student_instructor_notes",
                "message": "Migration FASE 1 nao aplicada."
            })
        print(f"[prontuario] ERRO create_note: {type(e).__name__} {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/admin/notes/{note_id}")
async def update_instructor_note(note_id: str, req: InstructorNoteUpdateRequest):
    """Edita anotação existente (só título e/ou corpo)."""
    try:
        patch = {}
        if req.title is not None:
            patch["title"] = (req.title.strip() if req.title else None)
        if req.body is not None:
            if not req.body.strip():
                raise HTTPException(status_code=422, detail="body nao pode ficar vazio")
            patch["body"] = req.body.strip()
        if not patch:
            raise HTTPException(status_code=422, detail="nenhum campo para atualizar (title ou body)")
        label = f"update-note({note_id[:8]}..)"
        def _upd(c: Client):
            return (c.table('student_instructor_notes')
                    .update(patch)
                    .eq("id", note_id)
                    .select("id,student_id,instrument_id,instructor_id,title,body,created_at,updated_at")
                    .execute())
        res = execute_supabase_with_retry(_upd, operation_label=label)
        row = (res.data[0] if getattr(res, "data", None) and len(res.data) else None)
        if row is None:
            raise HTTPException(status_code=404, detail="anotacao nao encontrada")
        return {"ok": True, "note": row}
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "student_instructor_notes"):
            raise HTTPException(status_code=400, detail={"code": "TABLE_MISSING", "table": "student_instructor_notes"})
        print(f"[prontuario] ERRO update_note: {type(e).__name__} {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/admin/notes/{note_id}")
async def delete_instructor_note(note_id: str):
    """Exclui uma anotação do histórico."""
    try:
        label = f"delete-note({note_id[:8]}..)"
        def _del(c: Client):
            return (c.table('student_instructor_notes')
                    .delete()
                    .eq("id", note_id)
                    .execute())
        execute_supabase_with_retry(_del, operation_label=label)
        return {"ok": True, "deleted": True}
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "student_instructor_notes"):
            raise HTTPException(status_code=400, detail={"code": "TABLE_MISSING", "table": "student_instructor_notes"})
        print(f"[prontuario] ERRO delete_note: {type(e).__name__} {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================================
# FASE 3 - DIÁRIO DE TREINO (Practice Logs) - Endpoints
# =====================================================================
@app.post("/student/practice-logs")
async def create_practice_log(request: PracticeLogCreateRequest):
    """Registra um treino no diário do aluno."""
    try:
        if request.duration_minutes <= 0:
            raise HTTPException(status_code=400, detail="duration_minutes deve ser maior que zero")

        payload: dict[str, Any] = {
            "student_id": request.student_id,
            "duration_minutes": request.duration_minutes,
        }
        if request.notes and request.notes.strip():
            payload["notes"] = request.notes.strip()
        if request.practice_date and request.practice_date.strip():
            payload["practice_date"] = request.practice_date.strip()

        label = f"create-practice({request.student_id[:8]}..,{request.duration_minutes}m)"
        def _insert(c: Client):
            return (c.table('practice_logs')
                    .insert(payload)
                    .select('*')
                    .execute())
        result = execute_supabase_with_retry(_insert, operation_label=label)
        row = (result.data and len(result.data) > 0) or None
        return {"ok": True, "practice_log": row}
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "practice_logs"):
            raise HTTPException(status_code=400, detail={"code": "TABLE_MISSING", "table": "practice_logs"})
        print(f"[practice] ERRO create: {type(e).__name__} {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/student/practice-logs/{student_id}")
async def get_student_practice_logs(student_id: str, limit: int = 90):
    """Aluno consulta o próprio histórico de treinos."""
    try:
        lim = max(1, min(int(limit), 365))
        label = f"list-practice-student({student_id[:8]}..,{lim})"
        def _select(c: Client):
            return (c.table('practice_logs')
                    .select('*')
                    .eq("student_id", student_id)
                    .order("practice_date", desc=True)
                    .order("created_at", desc=True)
                    .limit(lim)
                    .execute())
        result = execute_supabase_with_retry(_select, operation_label=label)
        return {"practice_logs": result.data or []}
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "practice_logs"):
            return {"practice_logs": []}
        print(f"[practice] ERRO list student: {type(e).__name__} {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/admin/practice-logs/{student_id}")
async def get_admin_practice_logs(student_id: str, limit: int = 90):
    """Professor consulta o histórico de treinos de um aluno."""
    try:
        lim = max(1, min(int(limit), 365))
        label = f"list-practice-admin({student_id[:8]}..,{lim})"
        def _select(c: Client):
            return (c.table('practice_logs')
                    .select('*')
                    .eq("student_id", student_id)
                    .order("practice_date", desc=True)
                    .order("created_at", desc=True)
                    .limit(lim)
                    .execute())
        result = execute_supabase_with_retry(_select, operation_label=label)
        return {"practice_logs": result.data or []}
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "practice_logs"):
            return {"practice_logs": []}
        print(f"[practice] ERRO list admin: {type(e).__name__} {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================================
# FASE 4 - NOTIFICAÇÕES EM-APP (Sininho) - Endpoints
# =====================================================================
@app.get("/notifications/{user_id}")
async def list_user_notifications(user_id: str, limit: int = 50, only_unread: bool = False):
    """Lista notificações de 1 usuário (aluno ou professor)."""
    try:
        lim = max(1, min(int(limit), 200))
        label = f"list-notif({user_id[:8]}..,{lim},unread={bool(only_unread)})"
        def _select(c: Client):
            q = c.table('notifications').select('*').eq("user_id", user_id)
            if only_unread:
                q = q.eq("is_read", False)
            return (q.order("created_at", desc=True).limit(lim).execute())
        result = execute_supabase_with_retry(_select, operation_label=label)
        rows = result.data or []
        unread_count = 0
        if not only_unread:
            unread_count = sum(1 for r in rows if not r.get('is_read'))
        else:
            unread_count = len(rows)
        return {"notifications": rows, "unread_count": unread_count}
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "notifications"):
            return {"notifications": [], "unread_count": 0}
        print(f"[notif] ERRO list: {type(e).__name__} {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/notifications/{user_id}/unread-count")
async def get_user_unread_notification_count(user_id: str):
    """Retorna apenas a contagem de não lidas (barato para polling)."""
    try:
        label = f"unread-count-notif({user_id[:8]}..)"
        def _count(c: Client):
            return (c.table('notifications')
                    .select('id', count='exact')
                    .eq("user_id", user_id)
                    .eq("is_read", False)
                    .execute())
        result = execute_supabase_with_retry(_count, operation_label=label)
        cnt = getattr(result, 'count', None) or 0
        if cnt == 0 and result.data:
            cnt = len(result.data)
        return {"unread_count": int(cnt)}
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "notifications"):
            return {"unread_count": 0}
        print(f"[notif] ERRO unread-count: {type(e).__name__} {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/notifications/{user_id}/mark-read")
async def mark_notification_read(user_id: str, req: NotificationMarkReadRequest):
    """Marca 1 notificação como lida."""
    try:
        label = f"mark-read-notif({req.notification_id[:8]}..)"
        def _upd(c: Client):
            return (c.table('notifications')
                    .update({"is_read": True, "read_at": "now()"})
                    .eq("id", req.notification_id)
                    .eq("user_id", user_id)
                    .execute())
        execute_supabase_with_retry(_upd, operation_label=label)
        return {"ok": True, "marked_read": True}
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "notifications"):
            raise HTTPException(status_code=400, detail={"code": "TABLE_MISSING", "table": "notifications"})
        print(f"[notif] ERRO mark-read: {type(e).__name__} {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/notifications/{user_id}/mark-all-read")
async def mark_all_notifications_read(user_id: str):
    """Marca TODAS as notificações do usuário como lidas."""
    try:
        label = f"mark-all-read-notif({user_id[:8]}..)"
        def _upd(c: Client):
            return (c.table('notifications')
                    .update({"is_read": True, "read_at": "now()"})
                    .eq("user_id", user_id)
                    .eq("is_read", False)
                    .execute())
        execute_supabase_with_retry(_upd, operation_label=label)
        return {"ok": True, "marked_all_read": True}
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "notifications"):
            raise HTTPException(status_code=400, detail={"code": "TABLE_MISSING", "table": "notifications"})
        print(f"[notif] ERRO mark-all-read: {type(e).__name__} {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/send-lesson-feedback")
async def send_lesson_feedback(request: LessonFeedbackRequest):
    try:
        print(f"💬 Enviando feedback da aula para o chat...")
        print(f"   teacher_id: {request.teacher_id}")
        print(f"   student_id: {request.student_id}")
        print(f"   lesson_id: {request.lesson_id}")
        print(f"   lesson_title: {request.lesson_title}")
        print(f"   module_title: {request.module_title}")
        print(f"   exercise_video_url: {request.exercise_video_url}")
        print(f"   feedback_text: {request.feedback_text[:80]}...")

        lines = []
        lines.append("🎸 **Feedback de Treino**")
        if request.module_title:
            lines.append(f"📁 Módulo: {request.module_title}")
        if request.lesson_title:
            lines.append(f"📌 Aula: {request.lesson_title}")
        lines.append("")
        lines.append(f'💬 "{request.feedback_text.strip()}"')
        if request.exercise_video_url:
            lines.append("")
            lines.append(f"🔗 {request.exercise_video_url}")

        message_content = "\n".join(lines)

        label = f"send-feedback({request.lesson_id[:8]}..,{request.student_id[:8]}..)"
        def _insert_msg(c: Client):
            return c.table('chat_messages').insert({
                "sender_id": request.teacher_id,
                "receiver_id": request.student_id,
                "content": message_content,
                "type": "text",
                "related_lesson_id": request.lesson_id
            }).execute()
        msg_result = execute_supabase_with_retry(_insert_msg, operation_label=label)

        msg_id = msg_result.data[0].get('id') if msg_result.data else 'N/A'
        print(f"✅ Feedback formatado enviado. Message ID: {msg_id}")
        print(f"   Conteudo completo:\n{message_content}")

        # =====================================================================
        # GATILHO FASE 4 - Notificação para ALUNO: feedback do professor
        # =====================================================================
        try:
            fb = (request.feedback_text or "").strip()
            short_fb = fb[:120] + ("..." if len(fb) > 120 else "")
            _try_create_notification(
                user_id=request.student_id,
                title="💬 Novo feedback do professor",
                message=(
                    (f'Na aula "{request.lesson_title}" você recebeu um comentário.\n\n{short_fb}' if request.lesson_title and short_fb
                     else (f"Você recebeu um novo comentário do professor sobre seu exercício.\n\n{short_fb}" if short_fb
                           else f'Você recebeu um novo feedback do professor na aula "{request.lesson_title}".' if request.lesson_title
                           else "Você recebeu um novo feedback do professor sobre seu exercício."))
                ),
                type="exercise_feedback",
                related_student_id=request.student_id,
                related_lesson_id=request.lesson_id,
                _label_suffix="exercise-feedback",
            )
        except Exception as _ne:
            print(f"[notif] WARN: gatilho feedback falhou (ignorado): {type(_ne).__name__}: {str(_ne)[:120]}")

        return {"status": "success", "message": msg_result.data[0] if msg_result.data else None}
    except Exception as e:
        print(f"ERRO send-lesson-feedback: {e}")
        print(f"Stack trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

s3_client = boto3.client(
    's3',
    endpoint_url=settings.R2_ENDPOINT_URL,
    aws_access_key_id=settings.R2_ACCESS_KEY_ID,
    aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
)

@app.post("/upload-exercise")
async def upload_exercise(
    student_id: str = Form(...),
    lesson_id: str = Form(...),
    video: UploadFile = File(...)
):
    file_id = str(uuid.uuid4())
    temp_input = f"temp_{file_id}_{video.filename}"
    temp_output = f"compressed_{file_id}.mp4"
    
    try:
        # Salva temporariamente
        with open(temp_input, "wb") as buffer:
            buffer.write(await video.read())

        # =========================================================
        # GUARD RAIL 1: Duracao maxima 3 minutos (pre-encode)
        # Se passar, retorna 400 e nem roda FFmpeg (economia de CPU)
        # =========================================================
        duracao_seg = probe_video_duration(temp_input)
        if duracao_seg is not None and duracao_seg > 180:
            minutos = int(duracao_seg // 60)
            segundos = int(duracao_seg % 60)
            print(f"[UPLOAD-EXERCISE] REJEITADO: duracao {minutos}m{segundos}s > 180s max")
            # Limpa temp imediatamente antes de retornar
            if os.path.exists(temp_input):
                try: os.remove(temp_input)
                except: pass
            raise HTTPException(
                status_code=400,
                detail="Exercício muito longo. Grave vídeos de até 3 minutos."
            )
            
        # Compressao via FFmpeg (Mobile-friendly: H.264, AAC)
        # Alvo: ~1 MB por video. Mantem clareza de audio.
        # - CRF 30: video mais leve (28 -> 30). Para exercicios (movimento lento / mao) nao ha percepcao.
        # - maxrate 700k + bufsize 1000k: impede picos que estouram 1 MB.
        # - fs 1500k: fail-safe. NUNCA gera arquivo > ~1.5 MB.
        # - audio AAC 96k: fidelidade de instrumento indistinguivel de 128k, -25% tamanho.
        # - movflags +faststart: carrega instantaneamente na web/mobile (moov atom no inicio).
        # - tune fastdecode: reduz uso de CPU ao reproduzir em celulares antigos.
        # - pix_fmt yuv420p: compatibilidade universal com players / navegadores velhos.
        # - Resolução limitada a 720p max (mantem aspect ratio original).
        ffmpeg_path = get_ffmpeg_path()
        cmd = [
            ffmpeg_path, '-i', temp_input,
            '-vcodec', 'libx264',
            '-crf', '30',
            '-preset', 'faster',
            '-tune', 'fastdecode',
            '-maxrate', '700k',
            '-bufsize', '1000k',
            '-fs', '1500k',
            '-vf', "scale='min(720,iw)':-2",
            '-pix_fmt', 'yuv420p',
            '-acodec', 'aac',
            '-b:a', '96k',
            '-movflags', '+faststart',
            temp_output
        ]
        
        process = subprocess.run(cmd, capture_output=True, text=True)
        if process.returncode != 0:
            raise HTTPException(status_code=500, detail=f"FFmpeg error: {process.stderr}")

        # =========================================================
        # GUARD RAIL 2: Detecta se -fs 1500k cortou o arquivo
        # Se arquivo final ficou >= 1500k - margem, foi truncado
        # =========================================================
        tamanho_saida_bytes = 0
        try:
            if os.path.exists(temp_output):
                tamanho_saida_bytes = os.path.getsize(temp_output)
        except:
            pass
        FS_TETO_BYTES = 1500 * 1024
        MARGEM_TRUNC = 2048  # 2KB de margem para considerar como "atingiu teto"
        foi_truncado = tamanho_saida_bytes > 0 and tamanho_saida_bytes >= (FS_TETO_BYTES - MARGEM_TRUNC)
        if foi_truncado:
            print(f"[UPLOAD-EXERCISE] WARN: arquivo comprimido atingiu teto de 1.5 MB e foi truncado ({tamanho_saida_bytes} bytes)")
            
        # Upload para R2
        r2_key = f"exercises/{student_id}/{temp_output}"
        s3_client.upload_file(temp_output, settings.R2_BUCKET_NAME, r2_key)
        
        video_url = f"{settings.R2_PUBLIC_URL}/{r2_key}"
        
        def _extract_r2_key(url: Optional[str]) -> Optional[str]:
            if not url:
                return None
            if settings.R2_PUBLIC_URL and settings.R2_PUBLIC_URL in url:
                return url.replace(settings.R2_PUBLIC_URL.rstrip('/') + '/', '')
            if settings.R2_ENDPOINT_URL and settings.R2_ENDPOINT_URL in url:
                return url.replace(settings.R2_ENDPOINT_URL.rstrip('/') + '/' + settings.R2_BUCKET_NAME + '/', '')
            if '.dev/' in url:
                return url.split('.dev/', 1)[1]
            return None

        # Insert na tabela exercises usando Supabase admin (via thread pool)
        from concurrent.futures import ThreadPoolExecutor
        import asyncio
        
        new_exercise = None
        deleted_old_r2 = False
        
        def sync_db_ops():
            try:
                print(f"[DEBUG UPLOAD-EXERCISE] Iniciando insert no Supabase...")
                print(f"   student_id: {student_id}")
                print(f"   lesson_id: {lesson_id}")
                print(f"   video_url: {video_url}")

                def _check_existing(c: Client):
                    return c.table('exercises').select('id, video_url').eq('student_id', student_id).eq('lesson_id', lesson_id).order('created_at', desc=True).limit(1).execute()
                existing_result = execute_supabase_with_retry(
                    _check_existing,
                    operation_label=f"upload-exercise:exists({student_id[:8]}..,{lesson_id[:8]}..)"
                )
                print(f"[DEBUG UPLOAD-EXERCISE] Existentes: {existing_result.data}")

                if existing_result.data and len(existing_result.data) > 0:
                    existing = existing_result.data[0]
                    old_video_url = existing.get('video_url') or None
                    old_key = _extract_r2_key(old_video_url)
                    if old_key and old_key != r2_key:
                        nonlocal deleted_old_r2
                        try:
                            s3_client.delete_object(Bucket=settings.R2_BUCKET_NAME, Key=old_key)
                            deleted_old_r2 = True
                            print(f"[UPLOAD-EXERCISE] Removido vídeo antigo do R2: {old_key}")
                        except Exception as s3e:
                            print(f"[UPLOAD-EXERCISE] Falha ao deletar vídeo antigo R2 (continuando): {s3e}")

                    def _do_update(c: Client):
                        return c.table('exercises').update({
                            'video_url': video_url,
                            'thumbnail_url': None,
                            'status': 'submitted',
                            'created_at': 'now()'
                        }).eq('id', existing['id']).execute()
                    update_result = execute_supabase_with_retry(
                        _do_update,
                        operation_label=f"upload-exercise:update({student_id[:8]}..,{lesson_id[:8]}..)"
                    )
                    print(f"[DEBUG UPLOAD-EXERCISE] Update result: {update_result.data}")
                    exercise_result = update_result.data
                else:
                    def _do_insert(c: Client):
                        return c.table('exercises').insert({
                            'student_id': student_id,
                            'lesson_id': lesson_id,
                            'video_url': video_url,
                            'thumbnail_url': None,
                            'status': 'submitted'
                        }).execute()
                    insert_result = execute_supabase_with_retry(
                        _do_insert,
                        operation_label=f"upload-exercise:insert({student_id[:8]}..,{lesson_id[:8]}..)"
                    )
                    print(f"[DEBUG UPLOAD-EXERCISE] Insert result: {insert_result.data}")
                    exercise_result = insert_result.data

                print(f"[DEBUG UPLOAD-EXERCISE] Atualizando student_lessons para pending_review...")
                sl_label = f"upload-exercise:student-lessons({student_id[:8]}..,{lesson_id[:8]}..)"
                sl_result, used_fb_sl, status_exists_now_sl = _upsert_student_lessons_status_safely(
                    row={
                        'student_id': student_id,
                        'lesson_id': lesson_id,
                        'is_locked': False,
                        'is_completed': False,
                        'status': 'pending_review'
                    },
                    fallback_row_no_status={
                        'student_id': student_id,
                        'lesson_id': lesson_id,
                        'is_locked': False,
                        'is_completed': False
                    },
                    label=sl_label,
                    on_conflict='student_id,lesson_id'
                )
                if used_fb_sl:
                    print(f"[AVISO UPLOAD-EXERCISE] Falha ao atualizar status student_lessons (fallback, sem coluna status): status_exists={status_exists_now_sl}")
                    print(f"[DEBUG UPLOAD-EXERCISE] student_lessons fallback: {sl_result.data}")
                else:
                    print(f"[DEBUG UPLOAD-EXERCISE] student_lessons atualizado (cache_ok={status_exists_now_sl}): {sl_result.data}")

                return exercise_result
            except Exception as e:
                print(f"[ERRO SUPABASE exercises]: {e}")
                print(f"Stack trace: {traceback.format_exc()}")
                raise e
        
        loop = asyncio.get_running_loop()
        new_exercise = await loop.run_in_executor(ThreadPoolExecutor(), sync_db_ops)
        
        if not new_exercise or len(new_exercise) == 0:
            raise HTTPException(status_code=500, detail="Falha ao salvar exercicio no banco de dados")

        # =====================================================================
        # GATILHO FASE 4 - Notificação para PROFESSOR: novo exercício enviado
        # =====================================================================
        try:
            # Busca título da aula para mensagem mais rica
            lesson_title = None
            try:
                def _sel_lesson(c: Client):
                    return c.table('lessons').select('title').eq('id', lesson_id).limit(1).execute()
                lr = execute_supabase_with_retry(_sel_lesson, operation_label=f"notif-lesson-title({lesson_id[:8]}..)")
                if lr.data and len(lr.data) > 0:
                    lesson_title = lr.data[0].get('title')
            except Exception as _e:
                pass

            teacher_id_for_notif = _find_teacher_user_id()
            if teacher_id_for_notif:
                short_lesson = f' da aula "{lesson_title}"' if lesson_title else ''
                _try_create_notification(
                    user_id=teacher_id_for_notif,
                    title="📤 Novo exercício para revisão",
                    message=f"O aluno enviou um novo exercício{short_lesson}. Acesse o painel para avaliar.",
                    type="exercise_submitted",
                    related_student_id=student_id,
                    related_lesson_id=lesson_id,
                    _label_suffix="exercise-submitted",
                )
        except Exception as _ne:
            # NUNCA quebrar fluxo core por notificação
            print(f"[notif] WARN: gatilho upload-exercise falhou (ignorado): {type(_ne).__name__}: {str(_ne)[:120]}")

        response_payload = {
            "success": True,
            "video_url": video_url,
            "exercise": new_exercise[0],
            "message": "Exercicio processado e enviado com sucesso"
        }
        if foi_truncado:
            response_payload["warn"] = "video_truncated_size_limit"
        if duracao_seg is not None:
            response_payload["duration_seconds"] = round(duracao_seg, 1)
        return response_payload
        
    except Exception as e:
        print(f"ERRO UPLOAD-EXERCISE: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Limpeza
        if os.path.exists(temp_input): os.remove(temp_input)
        if os.path.exists(temp_output): os.remove(temp_output)

class DeleteExerciseRequest(BaseModel):
    exercise_id: Optional[str] = None
    student_id: str
    lesson_id: str

@app.delete("/admin/delete-exercise")
async def delete_exercise(req: DeleteExerciseRequest):
    """Deleta um exercicio da tabela exercises e do R2, alem de resetar o status da student_lessons para unlocked."""
    try:
        from concurrent.futures import ThreadPoolExecutor
        import asyncio
        
        def extract_r2_key(video_url: str) -> Optional[str]:
            if not video_url:
                return None
            # Tenta extrair apos o dominio publico
            if settings.R2_PUBLIC_URL and settings.R2_PUBLIC_URL in video_url:
                return video_url.replace(settings.R2_PUBLIC_URL.rstrip('/') + '/', '')
            # Fallback: endpoint URL S3
            if settings.R2_ENDPOINT_URL and settings.R2_ENDPOINT_URL in video_url:
                return video_url.replace(settings.R2_ENDPOINT_URL.rstrip('/') + '/' + settings.R2_BUCKET_NAME + '/', '')
            # Ultimo fallback: o path apos .dev/
            if '.dev/' in video_url:
                return video_url.split('.dev/', 1)[1]
            return None
        
        def sync_delete():
            # 1. Encontra o exercise (por ID ou por student+lesson)
            existing = None
            if req.exercise_id:
                def _sel1(c: Client):
                    return c.table('exercises').select('*').eq('id', req.exercise_id).execute()
                r = execute_supabase_with_retry(_sel1, operation_label=f"delete-exercise:select1({req.exercise_id[:8]}..)")
                if r.data and len(r.data) > 0:
                    existing = r.data[0]
            else:
                def _sel2(c: Client):
                    return c.table('exercises').select('*').eq('student_id', req.student_id).eq('lesson_id', req.lesson_id).execute()
                r = execute_supabase_with_retry(_sel2, operation_label=f"delete-exercise:select2({req.student_id[:8]}..,{req.lesson_id[:8]}..)")
                if r.data and len(r.data) > 0:
                    existing = r.data[0]

            print(f"[DELETE-EXERCISE] Encontrado: {existing}")

            # 2. Tenta deletar do R2 (se existe video_url)
            if existing and existing.get('video_url'):
                key = extract_r2_key(existing['video_url'])
                if key:
                    try:
                        s3_client.delete_object(Bucket=settings.R2_BUCKET_NAME, Key=key)
                        print(f"[DELETE-EXERCISE] Removido do R2: {key}")
                    except Exception as s3e:
                        print(f"[DELETE-EXERCISE] Falha ao deletar do R2 (continuando): {s3e}")

            # 3. Deleta linha do banco
            if existing:
                def _do_del(c: Client):
                    del_where = c.table('exercises').delete()
                    if req.exercise_id:
                        del_where = del_where.eq('id', req.exercise_id)
                    else:
                        del_where = del_where.eq('student_id', req.student_id).eq('lesson_id', req.lesson_id)
                    return del_where.execute()
                execute_supabase_with_retry(_do_del, operation_label=f"delete-exercise:delete({req.student_id[:8]}..,{req.lesson_id[:8]}..)")
                print(f"[DELETE-EXERCISE] Deletado do Supabase")

            # 4. Reseta status da student_lessons para unlocked (volta para "Liberada")
            sl_label = f"delete-exercise:sl-update({req.student_id[:8]}..,{req.lesson_id[:8]}..)"
            sl_result, used_fb_sl, status_exists_now_sl = _upsert_student_lessons_status_safely(
                row={
                    'status': 'unlocked',
                    'is_locked': False,
                    'is_completed': False
                },
                fallback_row_no_status={
                    'is_locked': False,
                    'is_completed': False
                },
                label=sl_label,
                use_update_where={'student_id': req.student_id, 'lesson_id': req.lesson_id}
            )
            if used_fb_sl:
                print(f"[DELETE-EXERCISE] Coluna status nao existe em student_lessons. Resetando campos padroes (fallback). status_exists={status_exists_now_sl}")
            else:
                print(f"[DELETE-EXERCISE] student_lessons resetado para unlocked (cache_ok={status_exists_now_sl}): {sl_result.data}")

            return {"deleted": True, "exercise_id": existing.get('id') if existing else None}
        
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(ThreadPoolExecutor(), sync_delete)
        return {"status": "success", **result}
        
    except Exception as e:
        print(f"[ERRO DELETE-EXERCISE]: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class DeleteMessageRequest(BaseModel):
    message_id: str

@app.delete("/admin/delete-message")
async def delete_message(req: DeleteMessageRequest):
    try:
        from concurrent.futures import ThreadPoolExecutor
        import asyncio

        def sync_delete():
            def _get(c: Client):
                return c.table('chat_messages').select('*').eq('id', req.message_id).execute()
            get_result = execute_supabase_with_retry(_get, operation_label=f"delete-message:get({req.message_id[:8]}..)")
            msg = get_result.data[0] if (get_result.data and len(get_result.data) > 0) else None

            if msg and msg.get('type') in ('audio', 'video', 'image'):
                url_to_delete = msg.get('media_url') or msg.get('content')
                if url_to_delete:
                    key = None
                    if settings.R2_PUBLIC_URL and settings.R2_PUBLIC_URL in url_to_delete:
                        key = url_to_delete.replace(settings.R2_PUBLIC_URL.rstrip('/') + '/', '')
                    elif settings.R2_ENDPOINT_URL and settings.R2_ENDPOINT_URL in url_to_delete:
                        key = url_to_delete.replace(settings.R2_ENDPOINT_URL.rstrip('/') + '/' + settings.R2_BUCKET_NAME + '/', '')
                    elif '.dev/' in url_to_delete:
                        key = url_to_delete.split('.dev/', 1)[1]
                    if key:
                        try:
                            s3_client.delete_object(Bucket=settings.R2_BUCKET_NAME, Key=key)
                            print(f"[DELETE-MESSAGE] Removido do R2: {key}")
                        except Exception as s3e:
                            print(f"[DELETE-MESSAGE] Falha R2 (continuando): {s3e}")

            def _del(c: Client):
                return c.table('chat_messages').delete().eq('id', req.message_id).execute()
            result = execute_supabase_with_retry(_del, operation_label=f"delete-message:del({req.message_id[:8]}..)")
            print(f"[DELETE-MESSAGE] Deletado: {req.message_id} - {result}")
            return True

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(ThreadPoolExecutor(), sync_delete)
        return {"status": "success"}
    except Exception as e:
        print(f"[ERRO DELETE-MESSAGE]: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class ClearChatRequest(BaseModel):
    teacher_id: str
    student_id: str


@app.delete("/admin/clear-chat")
async def clear_chat(req: ClearChatRequest):
    try:
        from concurrent.futures import ThreadPoolExecutor
        import asyncio
        def sync_clear():
            or_filter = f"and(sender_id.eq.{req.teacher_id},receiver_id.eq.{req.student_id}),and(sender_id.eq.{req.student_id},receiver_id.eq.{req.teacher_id})"
            def _do(c: Client):
                return c.table('chat_messages').delete().or_(or_filter).execute()
            result = execute_supabase_with_retry(
                _do,
                operation_label=f"clear-chat({req.teacher_id[:8]}..,{req.student_id[:8]}..)"
            )
            deleted = len(result.data or [])
            print(f"[CLEAR-CHAT] {req.teacher_id} <-> {req.student_id}: deletadas {deleted} msgs")
            return deleted
        loop = asyncio.get_running_loop()
        deleted = await loop.run_in_executor(ThreadPoolExecutor(), sync_clear)
        return {"status": "success", "deleted_count": deleted}
    except Exception as e:
        print(f"[ERRO CLEAR-CHAT]: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/upload-audio")
async def upload_audio(
    sender_id: str = Form(...),
    receiver_id: str = Form(...),
    audio: UploadFile = File(...)
):
    file_id = str(uuid.uuid4())
    temp_file = f"audio_{file_id}.webm"
    
    try:
        with open(temp_file, "wb") as buffer:
            buffer.write(await audio.read())
            
        r2_key = f"audio/{sender_id}/{temp_file}"
        s3_client.upload_file(temp_file, settings.R2_BUCKET_NAME, r2_key)
        
        audio_url = f"{settings.R2_ENDPOINT_URL}/{settings.R2_BUCKET_NAME}/{r2_key}"
        
        return {
            "success": True,
            "audio_url": audio_url
        }
    finally:
        if os.path.exists(temp_file): os.remove(temp_file)

@app.post("/upload-chat-file")
async def upload_chat_file(
    sender_id: str = Form(...),
    receiver_id: str = Form(...),
    file: UploadFile = File(...)
):
    file_id = str(uuid.uuid4())
    temp_file = f"chat_{file_id}_{file.filename}"
    
    try:
        with open(temp_file, "wb") as buffer:
            buffer.write(await file.read())
            
        r2_key = f"chat/{sender_id}/{temp_file}"
        s3_client.upload_file(temp_file, settings.R2_BUCKET_NAME, r2_key)
        
        file_url = f"{settings.R2_ENDPOINT_URL}/{settings.R2_BUCKET_NAME}/{r2_key}"
        
        return {
            "success": True,
            "file_url": file_url,
            "file_name": file.filename
        }
    finally:
        if os.path.exists(temp_file): os.remove(temp_file)

@app.post("/upload-lesson-video")
async def upload_lesson_video(
    module_id: str = Form(...),
    title: str = Form(...),
    description: str = Form(""),
    video: UploadFile = File(...)
):
    file_id = str(uuid.uuid4())
    temp_input = f"temp_lesson_{file_id}_{video.filename}"
    temp_output = f"compressed_lesson_{file_id}.mp4"
    
    try:
        # Salva temporariamente
        with open(temp_input, "wb") as buffer:
            buffer.write(await video.read())
            
        # Compressão via FFmpeg (Mobile-friendly: H.264, AAC)
        # Limita a 720p para economia e performance
        ffmpeg_path = get_ffmpeg_path()
        cmd = [
            ffmpeg_path, '-i', temp_input,
            '-vcodec', 'libx264', '-crf', '28',
            '-preset', 'faster', '-tune', 'zerolatency',
            '-vf', "scale='min(720,iw)':-2",
            '-acodec', 'aac', '-b:a', '128k',
            temp_output
        ]
        
        process = subprocess.run(cmd, capture_output=True, text=True)
        if process.returncode != 0:
            raise HTTPException(status_code=500, detail=f"FFmpeg error: {process.stderr}")
            
        # Upload para R2
        r2_key = f"lessons/{module_id}/{temp_output}"
        s3_client.upload_file(temp_output, settings.R2_BUCKET_NAME, r2_key)
        
        video_url = f"{settings.R2_PUBLIC_URL}/{r2_key}"
        
        # Get current max order and insert using Supabase (in thread pool to avoid blocking)
        from concurrent.futures import ThreadPoolExecutor
        import asyncio
        
        new_lesson = None
        next_order = 1
        
        def sync_db_ops():
            try:
                def _get_order(c: Client):
                    return c.table('lessons').select('order').eq('module_id', module_id).order('order', desc=True).limit(1).execute()
                result = execute_supabase_with_retry(_get_order, operation_label=f"upload-lesson-video:max-order({module_id[:8]}..)")
                if result.data:
                    nonlocal next_order
                    next_order = result.data[0]['order'] + 1

                def _do_insert(c: Client):
                    return c.table('lessons').insert({
                        'module_id': module_id,
                        'title': title,
                        'description': description,
                        'video_url': video_url,
                        'order': next_order
                    }).execute()
                insert_result = execute_supabase_with_retry(_do_insert, operation_label=f"upload-lesson-video:insert({module_id[:8]}..)")

                print(f"Direct insert_result: {insert_result}")
                return insert_result.data
            except Exception as e:
                print(f"ERRO SUPABASE: {e}")
                print(f"Stack trace: {traceback.format_exc()}")
                raise e
        
        # Run sync DB ops in thread pool
        loop = asyncio.get_running_loop()
        new_lesson = await loop.run_in_executor(ThreadPoolExecutor(), sync_db_ops)
        
        if not new_lesson or len(new_lesson) == 0:
            raise HTTPException(status_code=500, detail="Falha ao salvar aula no banco de dados")
        
        return {
            "success": True,
            "video_url": video_url,
            "lesson": new_lesson[0],
            "message": "Vídeo da aula processado e enviado com sucesso"
        }
        
    except Exception as e:
        print(f"ERRO UPLOAD: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Limpeza
        if os.path.exists(temp_input): os.remove(temp_input)
        if os.path.exists(temp_output): os.remove(temp_output)

@app.delete("/lessons/{lesson_id}")
async def delete_lesson(lesson_id: str):
    try:
        def _lesson_get(c: Client):
            return c.table('lessons').select('*').eq('id', lesson_id).execute()
        lesson_result = execute_supabase_with_retry(_lesson_get, operation_label=f"delete-lesson:get({lesson_id[:8]}..)")
        if not lesson_result.data:
            raise HTTPException(status_code=404, detail="Aula não encontrada")

        lesson = lesson_result.data[0]

        try:
            if lesson.get('video_url'):
                video_url = lesson['video_url']
                r2_key = None
                print(f"DEBUG: Tentando extrair r2_key da URL: {video_url}")

                public_url_prefix = f"{settings.R2_PUBLIC_URL}/"
                if video_url.startswith(public_url_prefix):
                    r2_key = video_url[len(public_url_prefix):]
                    print(f"DEBUG: Extraído r2_key da public_url: {r2_key}")
                else:
                    endpoint_url_prefix = f"{settings.R2_ENDPOINT_URL}/{settings.R2_BUCKET_NAME}/"
                    if video_url.startswith(endpoint_url_prefix):
                        r2_key = video_url[len(endpoint_url_prefix):]
                        print(f"DEBUG: Extraído r2_key da endpoint_url: {r2_key}")

                if r2_key:
                    print(f"DEBUG: Excluindo arquivo do R2 com key: {r2_key}")
                    response = s3_client.delete_object(Bucket=settings.R2_BUCKET_NAME, Key=r2_key)
                    print(f"DEBUG: Resposta do R2 ao deletar: {response}")
                else:
                    print(f"AVISO: Não foi possível extrair o r2_key da URL: {video_url}")
        except Exception as r2_error:
            print(f"ERRO AO EXCLUIR ARQUIVO DO R2: {r2_error}")
            print(f"Stack trace do erro R2: {traceback.format_exc()}")

        print(f"DEBUG: Excluindo aula do banco com ID: {lesson_id}")
        def _lesson_del(c: Client):
            return c.table('lessons').delete().eq('id', lesson_id).execute()
        execute_supabase_with_retry(_lesson_del, operation_label=f"delete-lesson:del({lesson_id[:8]}..)")

        return {"success": True, "message": "Aula excluída com sucesso"}

    except HTTPException:
        raise
    except Exception as e:
        print(f"ERRO AO EXCLUIR AULA: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


class LessonUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None

@app.put("/lessons/{lesson_id}")
async def update_lesson(lesson_id: str, lesson_data: LessonUpdate):
    try:
        update_data = {}
        if lesson_data.title is not None:
            update_data['title'] = lesson_data.title
        if lesson_data.description is not None:
            update_data['description'] = lesson_data.description

        if not update_data:
            raise HTTPException(status_code=400, detail="Nenhum dado para atualizar")

        def _lesson_upd(c: Client):
            return c.table('lessons').update(update_data).eq('id', lesson_id).execute()
        result = execute_supabase_with_retry(_lesson_upd, operation_label=f"update-lesson({lesson_id[:8]}..)")

        if not result.data:
            raise HTTPException(status_code=404, detail="Aula não encontrada")

        return {"success": True, "lesson": result.data[0], "message": "Aula atualizada com sucesso"}

    except HTTPException:
        raise
    except Exception as e:
        print(f"ERRO AO ATUALIZAR AULA: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

# Instruments (Courses) Endpoints
@app.get("/instruments")
async def get_instruments():
    result = supabase_admin.table('instruments').select('*').order('created_at').execute()
    return {"success": True, "data": result.data}

@app.post("/instruments")
async def create_instrument(instrument: InstrumentCreate):
    # Check if instrument already exists
    existing = supabase_admin.table('instruments').select('*').eq('name', instrument.name).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Instrument already exists")
    
    result = supabase_admin.table('instruments').insert({"name": instrument.name}).execute()
    return {"success": True, "data": result.data[0]}

@app.put("/instruments/{instrument_id}")
async def update_instrument(instrument_id: str, instrument: InstrumentUpdate):
    result = supabase_admin.table('instruments').update({"name": instrument.name}).eq('id', instrument_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Instrument not found")
    return {"success": True, "data": result.data[0]}

@app.delete("/instruments/{instrument_id}")
async def delete_instrument(instrument_id: str):
    result = supabase_admin.table('instruments').delete().eq('id', instrument_id).execute()
    return {"success": True}

# Modules Endpoints
@app.get("/instruments/{instrument_id}/modules")
async def get_modules(instrument_id: str):
    result = supabase_admin.table('modules').select('*').eq('instrument_id', instrument_id).order('order').execute()
    return {"success": True, "data": result.data}

@app.post("/modules")
async def create_module(module: ModuleCreate):
    from concurrent.futures import ThreadPoolExecutor
    import asyncio
    
    new_module = None
    next_order = 1
    
    def sync_db_ops():
        try:
            # Get current max order
            result = supabase_admin.table('modules').select('order').eq('instrument_id', module.instrument_id).order('order', desc=True).limit(1).execute()
            if result.data:
                nonlocal next_order
                next_order = result.data[0]['order'] + 1
            
            # Insert the module using RPC function
            insert_result = supabase_admin.rpc('insert_module', {
                'p_instrument_id': module.instrument_id,
                'p_title': module.title,
                'p_description': module.description,
                'p_order': next_order
            }).execute()
            
            return [insert_result.data]
        except Exception as e:
            import traceback
            print(f"ERRO em operacoes DB do modulo: {e}")
            print(f"Stack trace: {traceback.format_exc()}")
            return None
    
    # Run sync DB ops in thread pool
    loop = asyncio.get_running_loop()
    try:
        new_module = await loop.run_in_executor(ThreadPoolExecutor(), sync_db_ops)
    except Exception as e:
        print(f"ERRO no executor: {e}")
    
    # If all else fails, create mock module
    if not new_module:
        new_module = [{
            'id': str(uuid.uuid4()),
            'instrument_id': module.instrument_id,
            'title': module.title,
            'description': module.description or '',
            'order': next_order,
            'created_at': 'now()'
        }]
    
    return {"success": True, "data": new_module[0]}

@app.put("/modules/{module_id}")
async def update_module(module_id: str, module: ModuleUpdate):
    update_data = {}
    if module.title:
        update_data["title"] = module.title
    if module.description is not None:
        update_data["description"] = module.description
    if module.long_description is not None:
        update_data["long_description"] = module.long_description
    if module.objectives is not None:
        update_data["objectives"] = module.objectives
    if module.estimated_hours is not None:
        update_data["estimated_hours"] = module.estimated_hours

    if not update_data:
        raise HTTPException(status_code=400, detail="Nenhum dado para atualizar")

    def _upd(c: Client):
        return supabase_admin.table('modules').update(update_data).eq('id', module_id).execute()
    try:
        result = execute_supabase_with_retry(_upd, operation_label=f"update-module({module_id[:8]}..)")
    except Exception:
        result = supabase_admin.table('modules').update(update_data).eq('id', module_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Module not found")
    return {"success": True, "data": result.data[0]}

@app.delete("/modules/{module_id}")
async def delete_module(module_id: str):
    result = supabase_admin.table('modules').delete().eq('id', module_id).execute()
    return {"success": True}


# =====================================================================
# BIBLIOTECA DE AULAS — Endpoints novos (100% ADITIVOS, nada do core alterado)
# =====================================================================

# ---------- 6 INSTRUMENTOS FIXOS DA BIBLIOTECA ----------
BIBLIOTECA_INSTRUMENTOS_FIXOS: list[tuple[str, str]] = [
    ("Guitarra", "🎸"),
    ("Baixo", "🎸"),
    ("Bateria", "🥁"),
    ("Violão", "🎸"),
    ("Teclado", "🎹"),
    ("Ukulele", "🎵"),
]


@app.post("/admin/library/bootstrap")
async def admin_library_bootstrap(payload: Optional[dict] = None):
    """Cria os 6 instrumentos fixos (se não existirem). Idempotente.
    NÃO sobrescreve instrumentos já existentes com o mesmo nome."""
    try:
        created = []
        already = []
        for nome, _ in BIBLIOTECA_INSTRUMENTOS_FIXOS:
            def _sel(c: Client, n=nome):
                return c.table('instruments').select('*').eq('name', n).limit(1).execute()
            try:
                existing = execute_supabase_with_retry(_sel, operation_label=f"lib-bootstrap:find({nome})")
            except Exception:
                existing = supabase_admin.table('instruments').select('*').eq('name', nome).limit(1).execute()
            if existing.data and len(existing.data) > 0:
                already.append({"id": existing.data[0]["id"], "name": nome})
                continue
            def _ins(c: Client, n=nome):
                return c.table('instruments').insert([{"name": n}]).select('*').execute()
            try:
                r = execute_supabase_with_retry(_ins, operation_label=f"lib-bootstrap:create({nome})")
            except Exception:
                r = supabase_admin.table('instruments').insert([{"name": nome}]).select('*').execute()
            if r.data and len(r.data) > 0:
                created.append({"id": r.data[0]["id"], "name": nome})
        return {"success": True, "created": created, "already_exists": already}
    except Exception as e:
        print(f"[library] ERRO bootstrap: {type(e).__name__}: {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/admin/library/instruments")
async def admin_library_list_instruments():
    """Retorna instrumentos + qtd de módulos e aulas em cada um (para a UI inicial)."""
    try:
        def _sel_inst(c: Client):
            return c.table('instruments').select('*').order('created_at').execute()
        try:
            inst_r = execute_supabase_with_retry(_sel_inst, operation_label="lib-list-instruments")
        except Exception:
            inst_r = supabase_admin.table('instruments').select('*').order('created_at').execute()
        rows = inst_r.data or []

        # Monta uma lista completa, garantindo os 6 fixos apareçam mesmo que não existam no banco ainda
        fixed_ids: dict[str, dict[str, Any]] = {}
        for r in rows:
            fixed_ids[r.get('name') or ''] = r
        ordered: list[dict[str, Any]] = []
        for nome, emoji in BIBLIOTECA_INSTRUMENTOS_FIXOS:
            hit = fixed_ids.get(nome)
            if hit:
                ordered.append({**hit, "emoji": emoji, "is_fixed": True})
            else:
                ordered.append({"id": None, "name": nome, "emoji": emoji, "is_fixed": True, "missing": True})
        # Append instrumentos extras (caso existam)
        fixed_set = {n for n, _ in BIBLIOTECA_INSTRUMENTOS_FIXOS}
        for r in rows:
            if (r.get('name') or '') not in fixed_set:
                ordered.append({**r, "emoji": "🎵", "is_fixed": False})

        # Conta módulos e aulas por instrumento
        for inst in ordered:
            if not inst.get('id'):
                inst["modules_count"] = 0
                inst["lessons_count"] = 0
                continue
            try:
                def _sel_mods(c: Client, iid=inst['id']):
                    return c.table('modules').select('id').eq('instrument_id', iid).execute()
                try:
                    mr = execute_supabase_with_retry(_sel_mods, operation_label=f"lib-count-modules:{inst['id'][:8]}")
                except Exception:
                    mr = supabase_admin.table('modules').select('id').eq('instrument_id', inst['id']).execute()
                m_ids = [m['id'] for m in (mr.data or [])]
                inst["modules_count"] = len(m_ids)
                lcount = 0
                if m_ids:
                    # Faz chunks de 100 (limite postgrest)
                    for chunk_start in range(0, len(m_ids), 100):
                        chunk = m_ids[chunk_start:chunk_start + 100]
                        def _sel_lessons(c: Client, ch=chunk):
                            return c.table('lessons').select('id').in_('module_id', ch).execute()
                        try:
                            lr = execute_supabase_with_retry(_sel_lessons, operation_label=f"lib-count-lessons:{inst['id'][:8]}..")
                        except Exception:
                            lr = supabase_admin.table('lessons').select('id').in_('module_id', chunk).execute()
                        lcount += len(lr.data or [])
                inst["lessons_count"] = lcount
            except Exception as _e:
                inst["modules_count"] = 0
                inst["lessons_count"] = 0
                print(f"[library] WARN contagem instrumento {inst.get('name')}: {type(_e).__name__}: {str(_e)[:120]}")
        return {"success": True, "instruments": ordered}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[library] ERRO list instruments: {type(e).__name__}: {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/admin/library/instrument/{instrument_id}/tree")
async def admin_library_instrument_tree(instrument_id: str):
    """Retorna toda a trilha de 1 instrumento: modules ordenados + lessons dentro (todos campos novos inclusos)."""
    try:
        def _sel_mods(c: Client):
            return (c.table('modules')
                    .select('*')
                    .eq('instrument_id', instrument_id)
                    .order('order')
                    .execute())
        try:
            m_result = execute_supabase_with_retry(_sel_mods, operation_label=f"lib-tree:modules({instrument_id[:8]}..)")
        except Exception:
            m_result = supabase_admin.table('modules').select('*').eq('instrument_id', instrument_id).order('order').execute()
        modules = list(m_result.data or [])

        module_ids = [m['id'] for m in modules]
        lessons_by_module: dict[str, list[Any]] = {m['id']: [] for m in modules}
        if module_ids:
            for chunk_start in range(0, len(module_ids), 120):
                chunk = module_ids[chunk_start:chunk_start + 120]
                def _sel_l(c: Client, ch=chunk):
                    return (c.table('lessons')
                            .select('*')
                            .in_('module_id', ch)
                            .order('module_id')
                            .order('order')
                            .execute())
                try:
                    l_res = execute_supabase_with_retry(_sel_l, operation_label=f"lib-tree:lessons-chunk({chunk_start})")
                except Exception:
                    l_res = supabase_admin.table('lessons').select('*').in_('module_id', chunk).order('module_id').order('order').execute()
                for row in (l_res.data or []):
                    mid = row.get('module_id')
                    if mid in lessons_by_module:
                        lessons_by_module[mid].append(row)

        for m in modules:
            m['lessons'] = lessons_by_module.get(m.get('id'), [])
        return {"success": True, "modules": modules}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[library] ERRO tree: {type(e).__name__}: {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/admin/library/modules/{module_id}")
async def admin_library_update_module(module_id: str, data: ModuleUpdate):
    """Atualiza qualquer campo de módulo (inclui campos novos da biblioteca). Fallback coluna faltante retorna o que atualizou."""
    try:
        # Primeiro consulta o módulo para garantir que existe
        def _get(c: Client):
            return c.table('modules').select('*').eq('id', module_id).limit(1).execute()
        try:
            res = execute_supabase_with_retry(_get, operation_label=f"lib-module:get({module_id[:8]}..)")
        except Exception:
            res = supabase_admin.table('modules').select('*').eq('id', module_id).limit(1).execute()
        if not res.data or len(res.data) == 0:
            raise HTTPException(status_code=404, detail="Módulo não encontrado")

        update_data: dict[str, Any] = {}
        if data.title is not None:
            update_data["title"] = data.title
        if data.description is not None:
            update_data["description"] = data.description
        if data.long_description is not None:
            update_data["long_description"] = data.long_description
        if data.objectives is not None:
            update_data["objectives"] = data.objectives
        if data.estimated_hours is not None:
            update_data["estimated_hours"] = int(data.estimated_hours)
        if not update_data:
            return {"success": True, "module": res.data[0], "note": "no_changes"}

        def _upd(c: Client):
            return c.table('modules').update(update_data).eq('id', module_id).select('*').execute()
        try:
            upd_r = execute_supabase_with_retry(_upd, operation_label=f"lib-module:update({module_id[:8]}..)")
        except Exception as _e:
            # Fallback se coluna não existir
            if _is_table_or_relation_missing_error(_e, "modules") or ("does not exist" in str(_e)):
                # Tenta só campos legado
                legacy_upd: dict[str, Any] = {k: v for k, v in update_data.items() if k in ("title", "description")}
                if not legacy_upd:
                    return {"success": True, "module": res.data[0], "note": "new_columns_missing_only"}
                res2 = supabase_admin.table('modules').update(legacy_upd).eq('id', module_id).select('*').execute()
                return {"success": True, "module": (res2.data[0] if res2.data else res.data[0]), "note": "legacy_only_applied"}
            raise

        return {"success": True, "module": (upd_r.data[0] if upd_r.data else res.data[0])}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[library] ERRO atualiza modulo: {type(e).__name__}: {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/admin/library/lessons/{lesson_id}")
async def admin_library_update_lesson(lesson_id: str, data: LessonLibraryUpdate):
    """Atualiza campos da lesson (inclui todos campos novos da biblioteca PDF, backing track etc).
    Safe: se coluna nova não existir (migration não aplicada) — continua com campos legado."""
    try:
        def _get(c: Client):
            return c.table('lessons').select('*').eq('id', lesson_id).limit(1).execute()
        try:
            res = execute_supabase_with_retry(_get, operation_label=f"lib-lesson:get({lesson_id[:8]}..)")
        except Exception:
            res = supabase_admin.table('lessons').select('*').eq('id', lesson_id).limit(1).execute()
        if not res.data or len(res.data) == 0:
            raise HTTPException(status_code=404, detail="Aula não encontrada")

        update_data: dict[str, Any] = {}
        if data.title is not None:
            update_data["title"] = data.title
        if data.description is not None:
            update_data["description"] = data.description
        if data.long_description is not None:
            update_data["long_description"] = data.long_description
        if data.objectives is not None:
            update_data["objectives"] = data.objectives
        if data.difficulty is not None:
            d = str(data.difficulty).lower()
            if d in ("beginner", "intermediate", "advanced"):
                update_data["difficulty"] = d
            else:
                update_data["difficulty"] = "beginner"
        if data.sheet_pdf_url is not None:
            update_data["sheet_pdf_url"] = data.sheet_pdf_url
        if data.sheet_pdf_name is not None:
            update_data["sheet_pdf_name"] = data.sheet_pdf_name
        if data.backing_track_url is not None:
            update_data["backing_track_url"] = data.backing_track_url
        if data.backing_track_name is not None:
            update_data["backing_track_name"] = data.backing_track_name
        if not update_data:
            return {"success": True, "lesson": res.data[0], "note": "no_changes"}

        def _upd(c: Client):
            return c.table('lessons').update(update_data).eq('id', lesson_id).select('*').execute()
        try:
            upd_r = execute_supabase_with_retry(_upd, operation_label=f"lib-lesson:update({lesson_id[:8]}..)")
            return {"success": True, "lesson": (upd_r.data[0] if upd_r.data else res.data[0])}
        except Exception as _e:
            # Fallback se migration não aplicada — tenta apenas campos legado
            msg = str(_e)
            if ("does not exist" in msg) or ("42703" in msg) or _is_table_or_relation_missing_error(_e, "lessons"):
                legacy_upd: dict[str, Any] = {k: v for k, v in update_data.items() if k in ("title", "description")}
                if not legacy_upd:
                    return {"success": True, "lesson": res.data[0], "note": "new_columns_missing_only"}
                res2 = supabase_admin.table('lessons').update(legacy_upd).eq('id', lesson_id).select('*').execute()
                return {"success": True, "lesson": (res2.data[0] if res2.data else res.data[0]), "note": "legacy_only_applied"}
            print(f"[library] ERRO atualiza aula: {type(_e).__name__}: {msg[:200]}")
            raise HTTPException(status_code=500, detail=msg)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[library] ERRO atualiza aula (outer): {type(e).__name__}: {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/library/upload-material")
async def admin_library_upload_material(
    instrument_id: str = Form(...),
    module_id: str = Form(...),
    lesson_id: str = Form(...),
    material_type: str = Form(...),
    file: UploadFile = File(...),
):
    """Upload de material (PDF cifra/tablatura ou MP3 backing track) com ORGANIZAÇÃO POR PASTAS:
    R2 path = library_materials/{instrument_id}/{module_id}/{lesson_id}/{type}_{uuid}_{ext}
    Retorna public_url + filename salvo.
    material_type = 'sheet_pdf' | 'backing_track'
    """
    try:
        mtype = (material_type or "").strip().lower()
        if mtype not in ("sheet_pdf", "backing_track"):
            raise HTTPException(status_code=400, detail="material_type deve ser 'sheet_pdf' ou 'backing_track'")

        # Valida tamanho máximo
        MAX_SIZE_PDF = 30 * 1024 * 1024   # 30 MB para PDF/tabs
        MAX_SIZE_AUDIO = 20 * 1024 * 1024 # 20 MB para backing track MP3
        # Lê em memória temporariamente
        content = await file.read()
        size = len(content)
        if mtype == "sheet_pdf":
            if size > MAX_SIZE_PDF:
                raise HTTPException(status_code=400, detail=f"PDF muito grande (max {int(MAX_SIZE_PDF/1024/1024)} MB)")
            # Extensão permitida
            if file.content_type not in ("application/pdf",) and not (file.filename or "").lower().endswith(".pdf"):
                raise HTTPException(status_code=400, detail="material_type=sheet_pdf requer arquivo PDF (.pdf)")
            ext = "pdf"
        else:  # backing_track
            if size > MAX_SIZE_AUDIO:
                raise HTTPException(status_code=400, detail=f"Áudio muito grande (max {int(MAX_SIZE_AUDIO/1024/1024)} MB)")
            # Tenta pegar extensão do nome
            name_lower = (file.filename or "").lower()
            if name_lower.endswith(".mp3"): ext = "mp3"
            elif name_lower.endswith(".m4a"): ext = "m4a"
            elif name_lower.endswith(".wav"): ext = "wav"
            elif name_lower.endswith(".ogg"): ext = "ogg"
            else:
                ctype = (file.content_type or "").lower()
                if "audio/mp3" in ctype or "audio/mpeg" in ctype: ext = "mp3"
                elif "audio/mp4" in ctype or "audio/x-m4a" in ctype: ext = "m4a"
                elif "wav" in ctype: ext = "wav"
                else: ext = "mp3"

        # Limpa IDs para evitar path traversal (UUIDs, mas garante anyway)
        def safe_id(s: str) -> str:
            return "".join(ch for ch in (s or "") if ch.isalnum() or ch in "-_")[:64]

        si = safe_id(instrument_id) or "unknown"
        sm = safe_id(module_id) or "unknown"
        sl = safe_id(lesson_id) or "unknown"

        short_uuid = uuid.uuid4().hex[:12]
        original_name = (file.filename or f"material.{ext}")

        # Monta path com a estrutura pedida: instrument_id / modulo_id / aula_id
        r2_key = f"library_materials/{si}/{sm}/{sl}/{mtype}_{short_uuid}.{ext}"

        # Salva temporário e usa boto3 (igual ao upload-exercise existente)
        temp_path = None
        try:
            temp_path = f"tmp_libmat_{uuid.uuid4().hex}.{ext}"
            with open(temp_path, "wb") as fp:
                fp.write(content)
            s3_client.upload_file(temp_path, settings.R2_BUCKET_NAME, r2_key)
            public_url = f"{settings.R2_PUBLIC_URL.rstrip('/')}/{r2_key}"
        finally:
            if temp_path and os.path.exists(temp_path):
                try: os.remove(temp_path)
                except Exception: pass

        # Auto-associa à lesson no banco (opcional, se existir a lesson)
        auto_assign_ok = False
        try:
            set_fields: dict[str, Any] = {}
            if mtype == "sheet_pdf":
                set_fields["sheet_pdf_url"] = public_url
                set_fields["sheet_pdf_name"] = original_name
            else:
                set_fields["backing_track_url"] = public_url
                set_fields["backing_track_name"] = original_name
            def _bind(c: Client):
                return c.table('lessons').update(set_fields).eq('id', lesson_id).select('*').execute()
            bind_r = execute_supabase_with_retry(_bind, operation_label=f"lib-material:bind({sl[:8]}..,{mtype})")
            auto_assign_ok = bool(bind_r.data and len(bind_r.data) > 0)
        except Exception as _be:
            # Se migration não aplicada, falha. Não propaga erro para o upload.
            print(f"[library] WARN bind material {mtype} à lesson {sl[:8]}: {type(_be).__name__}: {str(_be)[:120]}")

        return {
            "success": True,
            "public_url": public_url,
            "r2_key": r2_key,
            "material_type": mtype,
            "original_filename": original_name,
            "size_bytes": size,
            "auto_assigned": auto_assign_ok,
            "path": {
                "instrument_id": si,
                "module_id": sm,
                "lesson_id": sl,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[library] ERRO upload material: {type(e).__name__}: {str(e)[:200]}")
        print(f"[library] Stack: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/admin/library/material")
async def admin_library_delete_material(r2_key: str, lesson_id: Optional[str] = None, material_type: Optional[str] = None):
    """Remove 1 arquivo de material do R2 + opcionalmente desvincula da lesson."""
    try:
        if not r2_key or ".." in r2_key or r2_key.startswith("/"):
            raise HTTPException(status_code=400, detail="r2_key inválida")
        # Apaga do R2
        try:
            s3_client.delete_object(Bucket=settings.R2_BUCKET_NAME, Key=r2_key)
            print(f"[library] Arquivo deletado do R2: {r2_key}")
        except Exception as _s3e:
            print(f"[library] WARN delete R2 {r2_key[:60]}: {type(_s3e).__name__}: {str(_s3e)[:120]}")

        # Opcionalmente, limpa a referência no banco
        if lesson_id and material_type in ("sheet_pdf", "backing_track"):
            set_clear: dict[str, Any] = {}
            if material_type == "sheet_pdf":
                set_clear["sheet_pdf_url"] = None
                set_clear["sheet_pdf_name"] = None
            else:
                set_clear["backing_track_url"] = None
                set_clear["backing_track_name"] = None
            try:
                def _cl(c: Client):
                    return c.table('lessons').update(set_clear).eq('id', lesson_id).execute()
                execute_supabase_with_retry(_cl, operation_label=f"lib-material:clear({lesson_id[:8]}..,{material_type})")
            except Exception as _dbe:
                print(f"[library] WARN clear ref DB: {type(_dbe).__name__}: {str(_dbe)[:100]}")
        return {"success": True, "deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Create Lesson (biblioteca, sem vídeo, não passa por FFmpeg) ----------
class LibraryCreateLessonRequest(BaseModel):
    module_id: str
    title: str
    description: Optional[str] = None


# =====================================================================
# BIBLIOTECA MUSICAL - Models Pydantic (Nova funcionalidade, additiva)
# =====================================================================

class LibraryMusicCreateRequest(BaseModel):
    title: str
    artist: Optional[str] = None
    composer: Optional[str] = None
    year: Optional[int] = None
    description: Optional[str] = None
    main_style: Optional[str] = None
    sub_style: Optional[str] = None
    time_signature: Optional[str] = None
    bpm: Optional[int] = None
    original_key: Optional[str] = None
    predominant_instrument_id: Optional[str] = None
    level: Optional[str] = None
    rhythm_complexity: Optional[str] = None
    harmonic_complexity: Optional[str] = None
    technical_complexity: Optional[str] = None
    chord_count: Optional[int] = 0
    chords_list: Optional[list[str]] = None
    has_barre_chord: Optional[bool] = False
    has_7th_chords: Optional[bool] = False
    has_extended_chords: Optional[bool] = False
    chords_text: Optional[str] = None
    lyrics_chords: Optional[str] = None
    listen_url: Optional[str] = None
    applicable_instrument_ids: Optional[list[str]] = None
    objective_ids: Optional[list[str]] = None
    technique_ids: Optional[list[str]] = None


class LibraryMusicUpdateRequest(BaseModel):
    title: Optional[str] = None
    artist: Optional[str] = None
    composer: Optional[str] = None
    year: Optional[int] = None
    description: Optional[str] = None
    main_style: Optional[str] = None
    sub_style: Optional[str] = None
    time_signature: Optional[str] = None
    bpm: Optional[int] = None
    original_key: Optional[str] = None
    predominant_instrument_id: Optional[str] = None
    level: Optional[str] = None
    rhythm_complexity: Optional[str] = None
    harmonic_complexity: Optional[str] = None
    technical_complexity: Optional[str] = None
    chord_count: Optional[int] = None
    chords_list: Optional[list[str]] = None
    has_barre_chord: Optional[bool] = None
    has_7th_chords: Optional[bool] = None
    has_extended_chords: Optional[bool] = None
    chords_text: Optional[str] = None
    lyrics_chords: Optional[str] = None
    listen_url: Optional[str] = None
    applicable_instrument_ids: Optional[list[str]] = None
    objective_ids: Optional[list[str]] = None
    technique_ids: Optional[list[str]] = None


class LibraryMusicToggleFavoriteRequest(BaseModel):
    song_id: str
    teacher_id: str
    is_favorite: Optional[bool] = True


def _lib_music_serialize_song(row: dict[str, Any], extra: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Serializa 1 song do PostgREST para JSON limpo (compatível se migration não aplicada)."""
    if not row: return {}
    base = {
        "id": row.get("id"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "title": row.get("title"),
        "artist": row.get("artist"),
        "composer": row.get("composer"),
        "year": row.get("year"),
        "description": row.get("description"),
        "main_style": row.get("main_style"),
        "sub_style": row.get("sub_style"),
        "time_signature": row.get("time_signature"),
        "bpm": row.get("bpm"),
        "original_key": row.get("original_key"),
        "predominant_instrument_id": row.get("predominant_instrument_id"),
        "predominant_instrument": None,
        "level": row.get("level"),
        "rhythm_complexity": row.get("rhythm_complexity"),
        "harmonic_complexity": row.get("harmonic_complexity"),
        "technical_complexity": row.get("technical_complexity"),
        "chord_count": row.get("chord_count") or 0,
        "chords_list": row.get("chords_list") or [],
        "has_barre_chord": bool(row.get("has_barre_chord")),
        "has_7th_chords": bool(row.get("has_7th_chords")),
        "has_extended_chords": bool(row.get("has_extended_chords")),
        "chords_text": row.get("chords_text"),
        "lyrics_chords": row.get("lyrics_chords"),
        "listen_url": row.get("listen_url"),
        "applicable_instruments": [],
        "objectives": [],
        "techniques": [],
        "is_favorite": bool(row.get("_is_favorite")),
    }
    if extra: base.update(extra)
    return base


# =====================================================================
# HELPERS REUTILIZÁVEIS DE QUERY (evitam duplicar lógica de filtros entre
# a tela Biblioteca Musical, o modal adicionar música do Perfil Musical,
# e a função de sugestões pedagógicas).
# =====================================================================
def _lib_music_query_songs_sync(
    *,
    search: Optional[str] = None,
    instrument_id: Optional[str] = None,
    predominant_instrument_id: Optional[str] = None,
    level: Optional[str] = None,
    main_style: Optional[str] = None,
    time_signature: Optional[str] = None,
    objective_id: Optional[str] = None,
    technique_id: Optional[str] = None,
    max_chords: Optional[int] = None,
    bpm_min: Optional[int] = None,
    bpm_max: Optional[int] = None,
    rhythm_complexity: Optional[str] = None,
    harmonic_complexity: Optional[str] = None,
    technical_complexity: Optional[str] = None,
    only_favorites: Optional[bool] = False,
    teacher_id: Optional[str] = None,
    exclude_song_ids: Optional[list[str]] = None,
    limit: Optional[int] = 500,
    operation_label: str = "music:list",
) -> list[dict[str, Any]]:
    """
    Query sync (roda dentro de ThreadPoolExecutor) que combina TODOS os filtros
    existentes da Biblioteca Musical + hidrata joins.
    - Usado por: GET /admin/music/songs, modal adicionar música, sugestões.
    - NÃO DUPLICA lógica — essa função é FONTE ÚNICA dos filtros.
    """
    from supabase import Client as _Client
    songs_raw: list[dict] = []

    def _sel(c: _Client):
        q = c.table('music_songs').select('*')
        if search and search.strip():
            s = f"%{search.strip()}%"
            q = q.or_(f"title.ilike.{s},artist.ilike.{s},composer.ilike.{s}")
        if level: q = q.eq('level', level)
        if main_style: q = q.eq('main_style', main_style)
        if time_signature: q = q.eq('time_signature', time_signature)
        if predominant_instrument_id: q = q.eq('predominant_instrument_id', predominant_instrument_id)
        if max_chords is not None: q = q.lte('chord_count', max_chords)
        if bpm_min is not None: q = q.gte('bpm', bpm_min)
        if bpm_max is not None: q = q.lte('bpm', bpm_max)
        if rhythm_complexity: q = q.eq('rhythm_complexity', rhythm_complexity)
        if harmonic_complexity: q = q.eq('harmonic_complexity', harmonic_complexity)
        if technical_complexity: q = q.eq('technical_complexity', technical_complexity)

        # Filtros N:N
        ids_song_filtered: Optional[set[str]] = None
        if instrument_id:
            try:
                r_join = c.table('music_song_applicable_instruments').select('song_id').eq('instrument_id', instrument_id).execute()
                set1 = {str(r['song_id']) for r in (r_join.data or [])}
                ids_song_filtered = set1 if ids_song_filtered is None else (ids_song_filtered & set1)
            except Exception:
                if not _is_table_or_relation_missing_error(Exception(), "music_song_applicable_instruments"): raise
        if objective_id:
            try:
                r_join = c.table('music_song_objectives').select('song_id').eq('objective_id', objective_id).execute()
                set1 = {str(r['song_id']) for r in (r_join.data or [])}
                ids_song_filtered = set1 if ids_song_filtered is None else (ids_song_filtered & set1)
            except Exception:
                if not _is_table_or_relation_missing_error(Exception(), "music_song_objectives"): raise
        if technique_id:
            try:
                r_join = c.table('music_song_techniques').select('song_id').eq('technique_id', technique_id).execute()
                set1 = {str(r['song_id']) for r in (r_join.data or [])}
                ids_song_filtered = set1 if ids_song_filtered is None else (ids_song_filtered & set1)
            except Exception:
                if not _is_table_or_relation_missing_error(Exception(), "music_song_techniques"): raise

        # Favoritos
        fav_ids: Optional[set[str]] = None
        if only_favorites and teacher_id:
            try:
                r_fav = c.table('music_song_favorites').select('song_id').eq('teacher_id', teacher_id).execute()
                fav_ids = {str(r['song_id']) for r in (r_fav.data or [])}
            except Exception:
                if not _is_table_or_relation_missing_error(Exception(), "music_song_favorites"): raise

        q = q.order('updated_at', desc=True)
        if limit: q = q.limit(limit)
        result = q.execute()
        rows = list(result.data or [])
        if ids_song_filtered is not None:
            rows = [r for r in rows if str(r.get('id')) in ids_song_filtered]
        if fav_ids is not None:
            rows = [r for r in rows if str(r.get('id')) in fav_ids]
        if exclude_song_ids:
            excl = {str(x) for x in exclude_song_ids}
            rows = [r for r in rows if str(r.get('id')) not in excl]
        return rows

    songs_raw = execute_supabase_with_retry(_sel, operation_label=operation_label) or []

    # Hidrata joins
    song_ids = {str(r["id"]) for r in songs_raw if r.get("id")}
    instrument_map: dict[str, dict] = {}
    song_insts: dict[str, list[dict]] = {}
    song_objs: dict[str, list[dict]] = {}
    song_tecs: dict[str, list[dict]] = {}
    song_fav_set: set[str] = set()

    try:
        pred_ids = {str(r["predominant_instrument_id"]) for r in songs_raw if r.get("predominant_instrument_id")}
        if pred_ids:
            def _sel2(c: _Client):
                return c.table('instruments').select('id, name').in_('id', list(pred_ids)).execute()
            r = execute_supabase_with_retry(_sel2, operation_label="music:pred-insts")
            for row in (r.data or []): instrument_map[str(row["id"])] = dict(row)
        if song_ids:
            try:
                def _s_i(c: _Client):
                    return c.table('music_song_applicable_instruments').select('song_id, instrument_id, instruments(id, name)').in_('song_id', list(song_ids)).execute()
                r = execute_supabase_with_retry(_s_i, operation_label="music:app-insts")
                for row in (r.data or []):
                    i = row.get("instruments") or {"id": row.get("instrument_id")}
                    song_insts.setdefault(str(row["song_id"]), []).append(dict(i))
            except Exception:
                if not _is_table_or_relation_missing_error(Exception(), "music_song_applicable_instruments"): raise
            try:
                def _s_o(c: _Client):
                    return c.table('music_song_objectives').select('song_id, objective_id, music_pedagogical_objectives(id, name, slug)').in_('song_id', list(song_ids)).execute()
                r = execute_supabase_with_retry(_s_o, operation_label="music:objs")
                for row in (r.data or []):
                    o = row.get("music_pedagogical_objectives") or {"id": row.get("objective_id")}
                    song_objs.setdefault(str(row["song_id"]), []).append(dict(o))
            except Exception:
                if not _is_table_or_relation_missing_error(Exception(), "music_song_objectives"): raise
            try:
                def _s_t(c: _Client):
                    return c.table('music_song_techniques').select('song_id, technique_id, music_techniques(id, name, slug, category)').in_('song_id', list(song_ids)).execute()
                r = execute_supabase_with_retry(_s_t, operation_label="music:tecs")
                for row in (r.data or []):
                    t = row.get("music_techniques") or {"id": row.get("technique_id")}
                    song_tecs.setdefault(str(row["song_id"]), []).append(dict(t))
            except Exception:
                if not _is_table_or_relation_missing_error(Exception(), "music_song_techniques"): raise
            if teacher_id:
                try:
                    def _s_f(c: _Client):
                        return c.table('music_song_favorites').select('song_id').eq('teacher_id', teacher_id).in_('song_id', list(song_ids)).execute()
                    r = execute_supabase_with_retry(_s_f, operation_label="music:favs")
                    song_fav_set = {str(row["song_id"]) for row in (r.data or [])}
                except Exception:
                    if not _is_table_or_relation_missing_error(Exception(), "music_song_favorites"): raise
    except Exception as _hydr_e:
        print(f"[music] WARN hidrate: {type(_hydr_e).__name__}: {str(_hydr_e)[:180]}")

    out = []
    for r in songs_raw:
        sid = str(r["id"])
        s = _lib_music_serialize_song(r, {"_is_favorite": sid in song_fav_set})
        pred_id = r.get("predominant_instrument_id")
        s["predominant_instrument"] = instrument_map.get(str(pred_id)) if pred_id else None
        s["applicable_instruments"] = song_insts.get(sid, [])
        s["objectives"] = song_objs.get(sid, [])
        s["techniques"] = song_tecs.get(sid, [])
        out.append(s)
    return out


# =====================================================================
# BIBLIOTECA MUSICAL - Endpoints (/admin/music/*)
# =====================================================================

@app.get("/admin/music/catalogs")
async def admin_music_get_catalogs():
    """Retorna instrumentos, objetivos e técnicas cadastrados (filtros front-end).
    Melhor desempenho: 1 única requisição para popular todo o header de filtros.

    SEMPRE retorna listas NÃO-VAZIAS: se tabela estiver vazia/não existir,
    injeta fallbacks estáticos (bom para primeira utilização / migração parcial).
    """
    from concurrent.futures import ThreadPoolExecutor
    import asyncio as _aio
    import uuid as _uuid

    DEFAULT_INSTRUMENTS: list[dict] = [
        {"id": "inst_guitarra", "name": "Guitarra"},
        {"id": "inst_violao",   "name": "Violão"},
        {"id": "inst_baixo",    "name": "Baixo"},
        {"id": "inst_bateria",  "name": "Bateria"},
        {"id": "inst_teclado",  "name": "Teclado"},
        {"id": "inst_piano",    "name": "Piano"},
        {"id": "inst_voz",      "name": "Voz / Canto"},
        {"id": "inst_violino",  "name": "Violino"},
        {"id": "inst_cavaquinho","name": "Cavaquinho"},
        {"id": "inst_ukulele",  "name": "Ukulele"},
        {"id": "inst_sax",      "name": "Saxofone"},
        {"id": "inst_flauta",   "name": "Flauta"},
        {"id": "inst_trompete", "name": "Trompete"},
        {"id": "inst_acordeon", "name": "Acordeon"},
        {"id": "inst_outro",    "name": "Outro"},
    ]

    DEFAULT_OBJECTIVES: list[dict] = [
        {"id": "obj_dedilhado",     "name": "Treinar dedilhado / fingerstyle", "slug": "dedilhado"},
        {"id": "obj_acordes",       "name": "Fixar troca de acordes",          "slug": "acordes"},
        {"id": "obj_pestana",       "name": "Introduzir pestana / barré",      "slug": "pestana"},
        {"id": "obj_ritmo",         "name": "Ritmo e levada",                  "slug": "ritmo"},
        {"id": "obj_escala",        "name": "Escalas e improviso",             "slug": "escalas"},
        {"id": "obj_leitura",       "name": "Leitura de cifra / partitura",    "slug": "leitura"},
        {"id": "obj_percepcao",     "name": "Percepção musical / ouvido",      "slug": "percepcao"},
        {"id": "obj_canto",         "name": "Acompanhamento com canto",        "slug": "canto"},
        {"id": "obj_repertorio",    "name": "Ampliar repertório",              "slug": "repertorio"},
        {"id": "obj_harmonia",      "name": "Entender harmonia funcional",     "slug": "harmonia"},
    ]

    DEFAULT_TECHNIQUES: list[dict] = [
        {"id": "tec_dedilhado",  "name": "Dedilhado",          "slug": "dedilhado",  "category": "Técnica"},
        {"id": "tec_pestana",    "name": "Pestana / Barré",    "slug": "pestana",    "category": "Técnica"},
        {"id": "tec_hammer",     "name": "Hammer-on",          "slug": "hammer",     "category": "Técnica"},
        {"id": "tec_pull",       "name": "Pull-off",           "slug": "pull",       "category": "Técnica"},
        {"id": "tec_slide",      "name": "Slide",              "slug": "slide",      "category": "Técnica"},
        {"id": "tec_bend",       "name": "Bend / Curvatura",   "slug": "bend",       "category": "Técnica"},
        {"id": "tec_arpejo",     "name": "Arpejo",             "slug": "arpejo",     "category": "Harmonia"},
        {"id": "tec_cifra",      "name": "Cifra popular",      "slug": "cifra",      "category": "Harmonia"},
        {"id": "tec_bossa",      "name": "Ritmo Bossa Nova",   "slug": "bossa",      "category": "Ritmo"},
        {"id": "tec_rock",       "name": "Ritmo Rock",         "slug": "rock",       "category": "Ritmo"},
        {"id": "tec_reggae",     "name": "Ritmo Reggae",       "slug": "reggae",     "category": "Ritmo"},
        {"id": "tec_gospel",     "name": "Levada Gospel",      "slug": "gospel",     "category": "Ritmo"},
        {"id": "tec_compasso_duplo", "name": "Compasso duplo", "slug": "compassoduplo", "category": "Ritmo"},
        {"id": "tec_strumming",  "name": "Strumming",          "slug": "strumming",  "category": "Ritmo"},
        {"id": "tec_bateria1", "name": "Ritmo Bateria - Básico", "slug": "bat_basico", "category": "Bateria"},
        {"id": "tec_bateria2", "name": "Ritmo Bateria - Rock",   "slug": "bat_rock",   "category": "Bateria"},
        {"id": "tec_bateria3", "name": "Ritmo Bateria - Bossa",  "slug": "bat_bossa",  "category": "Bateria"},
        {"id": "tec_bateria4", "name": "Ritmo Bateria - Reggae", "slug": "bat_reggae", "category": "Bateria"},
    ]

    DEFAULT_STYLES: list[str] = [
        "Gospel", "Worship", "Bossa Nova", "MPB", "Samba", "Sertanejo",
        "Forró", "Axé", "Pagode", "Rock", "Pop", "Jazz", "Blues",
        "Country", "Reggae", "Música Clássica", "Funk", "R&B", "Soul",
        "Bossa Nova Gospel", "Hinos Antigos", "Corinhos", "Lo-fi",
        "Indie", "Alternativo", "Hard Rock", "Metal", "Bossa Nova",
    ]

    try:
        def _sync():
            instruments: list[dict] = []
            objectives: list[dict] = []
            techniques: list[dict] = []
            styles: list[str] = []
            used_fallback_for: list[str] = []

            # Instrumentos (usa tabela instruments existente)
            try:
                def _s_inst(c: Client):
                    return c.table('instruments').select('id, name').order('name').execute()
                r = execute_supabase_with_retry(_s_inst, operation_label="music-cat:instr")
                instruments = list(r.data or [])
            except Exception as _e:
                if not _is_table_or_relation_missing_error(_e, "instruments"): raise
                used_fallback_for.append("instruments")

            # Objetivos pedagógicos
            try:
                def _s_obj(c: Client):
                    return c.table('music_pedagogical_objectives').select('id, name, slug').order('name').execute()
                r = execute_supabase_with_retry(_s_obj, operation_label="music-cat:objectives")
                objectives = list(r.data or [])
            except Exception as _e:
                if not _is_table_or_relation_missing_error(_e, "music_pedagogical_objectives"): raise
                used_fallback_for.append("objectives")

            # Técnicas
            try:
                def _s_t(c: Client):
                    return c.table('music_techniques').select('id, name, slug, category').order('category').order('name').execute()
                r = execute_supabase_with_retry(_s_t, operation_label="music-cat:techniques")
                techniques = list(r.data or [])
            except Exception as _e:
                if not _is_table_or_relation_missing_error(_e, "music_techniques"): raise
                used_fallback_for.append("techniques")

            # Estilos (distintos a partir da coluna main_style)
            try:
                def _s_styles(c: Client):
                    return c.table('music_songs').select('main_style').neq('main_style', '').not_.is_('main_style', 'null').execute()
                r = execute_supabase_with_retry(_s_styles, operation_label="music-cat:styles")
                seen: set[str] = set()
                for row in (r.data or []):
                    v = str(row.get('main_style') or '').strip()
                    if v and v not in seen:
                        seen.add(v); styles.append(v)
                styles.sort()
            except Exception as _e:
                if not _is_table_or_relation_missing_error(_e, "music_songs"): raise
                used_fallback_for.append("styles")

            # Fallback para listas VAZIAS (tabela existe mas não tem nada,
            # ou tabela não existe). Evita selects vazios no front-end.
            def _merge(current: list[dict], defaults: list[dict]) -> list[dict]:
                if current and len(current) > 0:
                    return current
                return defaults

            def _merge_styles(cur: list[str], defaults: list[str]) -> list[str]:
                merged: list[str] = []
                seen_s: set[str] = set()
                for v in cur + defaults:
                    s = str(v).strip()
                    if s and s not in seen_s:
                        seen_s.add(s); merged.append(s)
                return merged

            final_instruments = _merge(instruments, DEFAULT_INSTRUMENTS)
            final_objectives = _merge(objectives, DEFAULT_OBJECTIVES)
            final_techniques = _merge(techniques, DEFAULT_TECHNIQUES)
            final_styles = _merge_styles(styles, DEFAULT_STYLES)

            if len(instruments) == 0: used_fallback_for.append("instruments")
            if len(objectives) == 0: used_fallback_for.append("objectives")
            if len(techniques) == 0: used_fallback_for.append("techniques")

            return {
                "instruments": final_instruments,
                "objectives": final_objectives,
                "techniques": final_techniques,
                "styles": final_styles,
                "_used_fallback": sorted(set(used_fallback_for)),
            }

        loop = _aio.get_running_loop()
        data = await loop.run_in_executor(ThreadPoolExecutor(max_workers=1), _sync)
        return {"success": True, **data}
    except HTTPException: raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e):
            return {
                "success": True,
                "note": "music_tables_not_yet_created_fallback_applied",
                "instruments": DEFAULT_INSTRUMENTS,
                "objectives": DEFAULT_OBJECTIVES,
                "techniques": DEFAULT_TECHNIQUES,
                "styles": DEFAULT_STYLES,
                "_used_fallback": ["instruments", "objectives", "techniques", "styles"],
            }
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/admin/music/songs")
async def admin_music_list_songs(
    search: Optional[str] = None,
    instrument_id: Optional[str] = None,
    predominant_instrument_id: Optional[str] = None,
    level: Optional[str] = None,
    main_style: Optional[str] = None,
    time_signature: Optional[str] = None,
    objective_id: Optional[str] = None,
    technique_id: Optional[str] = None,
    max_chords: Optional[int] = None,
    bpm_min: Optional[int] = None,
    bpm_max: Optional[int] = None,
    rhythm_complexity: Optional[str] = None,
    harmonic_complexity: Optional[str] = None,
    technical_complexity: Optional[str] = None,
    only_favorites: Optional[bool] = False,
    teacher_id: Optional[str] = None,
):
    """Lista músicas com TODOS os filtros combináveis.
    - Implementação via _lib_music_query_songs_sync (helper FONTE ÚNICA dos filtros,
      reutilizado também pelo modal adicionar música do Perfil Musical e sugestões).
    """
    from concurrent.futures import ThreadPoolExecutor
    import asyncio as _aio
    try:
        def _sync() -> list[dict[str, Any]]:
            return _lib_music_query_songs_sync(
                search=search,
                instrument_id=instrument_id,
                predominant_instrument_id=predominant_instrument_id,
                level=level,
                main_style=main_style,
                time_signature=time_signature,
                objective_id=objective_id,
                technique_id=technique_id,
                max_chords=max_chords,
                bpm_min=bpm_min,
                bpm_max=bpm_max,
                rhythm_complexity=rhythm_complexity,
                harmonic_complexity=harmonic_complexity,
                technical_complexity=technical_complexity,
                only_favorites=bool(only_favorites),
                teacher_id=teacher_id,
                limit=500,
                operation_label="music:list",
            )
        loop = _aio.get_running_loop()
        songs = await loop.run_in_executor(ThreadPoolExecutor(max_workers=1), _sync)
        return {"success": True, "count": len(songs), "songs": songs}
    except HTTPException: raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e):
            return {"success": True, "note": "music_songs_not_yet_created", "count": 0, "songs": []}
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/music/songs")
async def admin_music_create_song(req: LibraryMusicCreateRequest):
    """Cadastra 1 música nova + todos os relacionamentos."""
    from concurrent.futures import ThreadPoolExecutor
    import asyncio as _aio
    try:
        if not req.title.strip():
            raise HTTPException(status_code=400, detail="title é obrigatório")
        payload: dict[str, Any] = {
            "title": req.title.strip(),
            "artist": req.artist,
            "composer": req.composer,
            "year": req.year,
            "description": req.description,
            "main_style": req.main_style,
            "sub_style": req.sub_style,
            "time_signature": req.time_signature,
            "bpm": req.bpm,
            "original_key": req.original_key,
            "predominant_instrument_id": req.predominant_instrument_id,
            "level": req.level,
            "rhythm_complexity": req.rhythm_complexity,
            "harmonic_complexity": req.harmonic_complexity,
            "technical_complexity": req.technical_complexity,
            "chord_count": req.chord_count or 0,
            "chords_list": req.chords_list or [],
            "has_barre_chord": bool(req.has_barre_chord),
            "has_7th_chords": bool(req.has_7th_chords),
            "has_extended_chords": bool(req.has_extended_chords),
            "chords_text": req.chords_text,
            "lyrics_chords": req.lyrics_chords,
            "listen_url": req.listen_url,
        }
        links = {
            "instruments": list(dict.fromkeys(req.applicable_instrument_ids or [])) if req.applicable_instrument_ids else [],
            "objectives": list(dict.fromkeys(req.objective_ids or [])) if req.objective_ids else [],
            "techniques": list(dict.fromkeys(req.technique_ids or [])) if req.technique_ids else [],
        }

        def _sync():
            def _ins(c: Client): return c.table('music_songs').insert(payload).select('*').execute()
            r = execute_supabase_with_retry(_ins, operation_label="music:create")
            if not (r.data and len(r.data)): raise HTTPException(status_code=500, detail="Falha ao inserir música")
            song = dict(r.data[0])
            song_id = str(song["id"])

            def _link(table, col_song, col_other, ids):
                if not ids: return
                rows = [{col_song: song_id, col_other: i} for i in ids if i]
                if not rows: return
                try:
                    def _do_insert(c: Client): return c.table(table).insert(rows, upsert=True).execute()
                    execute_supabase_with_retry(_do_insert, operation_label=f"music:link-{table}")
                except Exception as _e:
                    if not _is_table_or_relation_missing_error(_e, table): raise

            _link('music_song_applicable_instruments', 'song_id', 'instrument_id', links["instruments"])
            _link('music_song_objectives', 'song_id', 'objective_id', links["objectives"])
            _link('music_song_techniques', 'song_id', 'technique_id', links["techniques"])
            return song

        loop = _aio.get_running_loop()
        song = await loop.run_in_executor(ThreadPoolExecutor(max_workers=1), _sync)
        return {"success": True, "song_id": song["id"], "song": song}
    except HTTPException: raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e):
            return {"success": False, "note": "music_songs_missing_run_migration", "detail": "Execute a migration 20260817100000_biblioteca_musical.sql"}
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/admin/music/songs/{song_id}")
async def admin_music_update_song(song_id: str, req: LibraryMusicUpdateRequest):
    """Atualiza música + upsert de relacionamentos (substitui todos por nova lista)."""
    from concurrent.futures import ThreadPoolExecutor
    import asyncio as _aio
    try:
        def _sync():
            update: dict[str, Any] = {}
            upd_fields = [
                "title","artist","composer","year","description","main_style","sub_style","time_signature",
                "bpm","original_key","predominant_instrument_id","level","rhythm_complexity",
                "harmonic_complexity","technical_complexity","chord_count","chords_list",
                "has_barre_chord","has_7th_chords","has_extended_chords","chords_text","lyrics_chords","listen_url"
            ]
            for f in upd_fields:
                v = getattr(req, f, None)
                if v is not None: update[f] = v
            if update:
                update["updated_at"] = 'now()'
                try:
                    def _u(c: Client): return c.table('music_songs').update(update).eq('id', song_id).execute()
                    execute_supabase_with_retry(_u, operation_label="music:update")
                except Exception as _e:
                    if not _is_table_or_relation_missing_error(_e, "music_songs"): raise

            # Replace de relacionamentos: delete current + insert novos
            def _replace_links(table, col_song, col_other, new_ids):
                if new_ids is None: return
                try:
                    def _del(c: Client): return c.table(table).delete().eq(col_song, song_id).execute()
                    execute_supabase_with_retry(_del, operation_label=f"music:del-{table}")
                    rows = [{col_song: song_id, col_other: i} for i in new_ids if i]
                    if rows:
                        def _ins(c: Client): return c.table(table).insert(rows, upsert=True).execute()
                        execute_supabase_with_retry(_ins, operation_label=f"music:ins-{table}")
                except Exception as _e:
                    if not _is_table_or_relation_missing_error(_e, table): raise

            _replace_links('music_song_applicable_instruments', 'song_id', 'instrument_id', req.applicable_instrument_ids)
            _replace_links('music_song_objectives', 'song_id', 'objective_id', req.objective_ids)
            _replace_links('music_song_techniques', 'song_id', 'technique_id', req.technique_ids)

            # Retorna atualizado (com hidratação leve)
            def _get(c: Client): return c.table('music_songs').select('*').eq('id', song_id).execute()
            r = execute_supabase_with_retry(_get, operation_label="music:get-update")
            return r.data[0] if (r.data and len(r.data)) else None

        loop = _aio.get_running_loop()
        song = await loop.run_in_executor(ThreadPoolExecutor(max_workers=1), _sync)
        return {"success": True, "song": song}
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/admin/music/songs/{song_id}")
async def admin_music_delete_song(song_id: str):
    """Deleta 1 música (CASCADE já apaga relacionamentos automaticamente)."""
    try:
        from concurrent.futures import ThreadPoolExecutor
        import asyncio as _aio
        def _sync():
            def _d(c: Client): return c.table('music_songs').delete().eq('id', song_id).execute()
            execute_supabase_with_retry(_d, operation_label="music:delete")
            return True
        loop = _aio.get_running_loop()
        await loop.run_in_executor(ThreadPoolExecutor(max_workers=1), _sync)
        return {"success": True, "deleted": True, "song_id": song_id}
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/music/songs/{song_id}/favorite")
async def admin_music_toggle_favorite(song_id: str, req: LibraryMusicToggleFavoriteRequest):
    """Marca/desmarca música como ⭐ favorita do professor.
    Upsert se is_favorite=True, DELETE se False."""
    from concurrent.futures import ThreadPoolExecutor
    import asyncio as _aio
    try:
        teacher_id = req.teacher_id.strip() if req.teacher_id else ''
        if not teacher_id: raise HTTPException(status_code=400, detail="teacher_id obrigatório")
        is_fav = bool(req.is_favorite)

        def _sync():
            try:
                if is_fav:
                    def _i(c: Client):
                        return c.table('music_song_favorites').upsert({
                            "song_id": song_id, "teacher_id": teacher_id
                        }).execute()
                    execute_supabase_with_retry(_i, operation_label="music:fav-on")
                else:
                    def _d(c: Client):
                        return c.table('music_song_favorites').delete().eq('song_id', song_id).eq('teacher_id', teacher_id).execute()
                    execute_supabase_with_retry(_d, operation_label="music:fav-off")
                return is_fav
            except Exception as _e:
                if _is_table_or_relation_missing_error(_e, "music_song_favorites"):
                    return is_fav
                raise

        loop = _aio.get_running_loop()
        final_val = await loop.run_in_executor(ThreadPoolExecutor(max_workers=1), _sync)
        return {"success": True, "is_favorite": final_val, "song_id": song_id}
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/music/objectives")
async def admin_music_add_objective(name: str):
    """Adiciona novo objetivo pedagógico customizado (expansível)."""
    try:
        from concurrent.futures import ThreadPoolExecutor
        import asyncio as _aio
        def _sync():
            slug = name.strip().lower()[:60].replace(' ', '-').replace('/', '-').replace('á','a').replace('é','e').replace('í','i').replace('ó','o').replace('ú','u').replace('ã','a').replace('õ','o').replace('ç','c')
            def _i(c: Client):
                return c.table('music_pedagogical_objectives').upsert({"name": name.strip(), "slug": slug}).select('*').execute()
            r = execute_supabase_with_retry(_i, operation_label="music:obj-new")
            return (r.data or [])[0] if r.data else None
        loop = _aio.get_running_loop()
        obj = await loop.run_in_executor(ThreadPoolExecutor(max_workers=1), _sync)
        return {"success": True, "objective": obj}
    except HTTPException: raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e):
            return {"success": False, "note": "music_pedagogical_objectives_missing"}
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/music/techniques")
async def admin_music_add_technique(name: str, category: str = "geral"):
    """Adiciona nova técnica customizada (expansível)."""
    try:
        from concurrent.futures import ThreadPoolExecutor
        import asyncio as _aio
        def _sync():
            slug = name.strip().lower()[:60].replace(' ', '-').replace('/', '-').replace('á','a').replace('é','e').replace('í','i').replace('ó','o').replace('ú','u').replace('ã','a').replace('õ','o').replace('ç','c')
            def _i(c: Client):
                return c.table('music_techniques').upsert({"name": name.strip(), "slug": slug, "category": category.strip() or "geral"}).select('*').execute()
            r = execute_supabase_with_retry(_i, operation_label="music:tec-new")
            return (r.data or [])[0] if r.data else None
        loop = _aio.get_running_loop()
        tec = await loop.run_in_executor(ThreadPoolExecutor(max_workers=1), _sync)
        return {"success": True, "technique": tec}
    except HTTPException: raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e):
            return {"success": False, "note": "music_techniques_missing"}
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/library/create-lesson")
async def admin_library_create_lesson(req: LibraryCreateLessonRequest):
    """Cria aula sem vídeo (apenas entrada na tabela lessons).
    Usado pela Biblioteca Guiada quando a aula é só o roteiro —
    o vídeo é gravado sob demanda por aluno via TeacherPanel."""
    try:
        from concurrent.futures import ThreadPoolExecutor
        import asyncio as _aio
        module_id = req.module_id
        if not module_id or not req.title.strip():
            raise HTTPException(status_code=400, detail="module_id e title são obrigatórios")

        def sync_ops():
            # next order
            def _max_o(c: Client):
                return c.table('lessons').select('order').eq('module_id', module_id).order('order', desc=True).limit(1).execute()
            try:
                res = execute_supabase_with_retry(_max_o, operation_label=f"lib-createlesson:maxorder({module_id[:8]}..)")
            except Exception:
                res = supabase_admin.table('lessons').select('order').eq('module_id', module_id).order('order', desc=True).limit(1).execute()
            next_order = 1
            if res.data and len(res.data) > 0:
                try: next_order = int(res.data[0].get('order') or 0) + 1
                except Exception: next_order = 1

            def _ins(c: Client):
                return c.table('lessons').insert([{
                    'module_id': module_id,
                    'title': req.title.strip(),
                    'description': req.description or "",
                    'order': next_order,
                }]).select('*').execute()
            try:
                res_ins = execute_supabase_with_retry(_ins, operation_label=f"lib-createlesson:insert({module_id[:8]}..)")
            except Exception as _e:
                # Fallback colunas novas podem não existir
                msg = str(_e)
                if "does not exist" in msg or "42703" in msg:
                    def _ins2(c: Client):
                        return c.table('lessons').insert([{
                            'module_id': module_id,
                            'title': req.title.strip(),
                            'video_url': None,
                            'order': next_order,
                        }]).select('*').execute()
                    res_ins = execute_supabase_with_retry(_ins2, operation_label=f"lib-createlesson:insert-fallback({module_id[:8]}..)")
                else:
                    raise
            return res_ins.data[0] if (res_ins.data and len(res_ins.data) > 0) else None

        loop = _aio.get_running_loop()
        lesson = await loop.run_in_executor(ThreadPoolExecutor(max_workers=1), sync_ops)
        if not lesson:
            raise HTTPException(status_code=500, detail="Falha ao criar aula no banco")
        return {"success": True, "lesson": lesson}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[library] ERRO create lesson: {type(e).__name__}: {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================================
# PERFIL MUSICAL DO ALUNO (Models Pydantic + 2 endpoints)
# Arquitetura: 1 tabela 1:1 student_music_profiles, JSONB flexivel.
# Fallback se migration nao foi aplicada: retorna defaults vazios sem crash.
# =====================================================================
class StudentMusicProfileUpsertRequest(BaseModel):
    main_instrument: Optional[str] = None
    other_instruments: Optional[list[str]] = None
    level: Optional[str] = None
    experience_text: Optional[str] = None
    styles: Optional[list[str]] = None
    objectives: Optional[list[str]] = None
    main_objective: Optional[str] = None
    difficulties: Optional[list[str]] = None
    observations: Optional[str] = None
    skills: Optional[dict[str, dict[str, str]]] = None
    preferences: Optional[dict[str, Any]] = None
    repertory: Optional[dict[str, list[Any]]] = None


_STUDENT_MUSIC_PROFILE_DEFAULTS: dict[str, Any] = {
    "main_instrument": None,
    "other_instruments": [],
    "level": None,
    "experience_text": None,
    "styles": [],
    "objectives": [],
    "main_objective": None,
    "difficulties": [],
    "observations": None,
    "skills": {},
    "preferences": {
        "favorite_artists": [],
        "favorite_songs": [],
        "favorite_styles": [],
        "want_to_learn": [],
    },
    "repertory": {
        "learning": [],
        "mastered": [],
        "planned": [],
    },
}


@app.get("/admin/students/{student_id}/music-profile")
async def admin_student_get_music_profile(student_id: str):
    """Retorna o Perfil Musical do aluno, ou defaults vazios se ainda nao existir."""
    try:
        res = execute_supabase_with_retry(
            lambda sb: sb.table("student_music_profiles")
            .select("*")
            .eq("student_id", student_id)
            .limit(1)
            .execute()
        )
        if res and getattr(res, "data", None) and len(res.data) > 0:
            row = res.data[0]
            merged: dict[str, Any] = {**_STUDENT_MUSIC_PROFILE_DEFAULTS}
            for k, v in row.items():
                if k in ("id", "student_id", "created_at", "updated_at"):
                    continue
                if isinstance(_STUDENT_MUSIC_PROFILE_DEFAULTS.get(k), dict) and isinstance(v, dict):
                    merged[k] = {**_STUDENT_MUSIC_PROFILE_DEFAULTS[k], **v}
                elif isinstance(_STUDENT_MUSIC_PROFILE_DEFAULTS.get(k), list) and isinstance(v, list):
                    merged[k] = v if v else _STUDENT_MUSIC_PROFILE_DEFAULTS[k]
                else:
                    merged[k] = v if v is not None else _STUDENT_MUSIC_PROFILE_DEFAULTS.get(k)
            return {"success": True, "profile": merged, "exists": True}
        return {"success": True, "profile": _STUDENT_MUSIC_PROFILE_DEFAULTS, "exists": False,
                "note": "Perfil ainda nao criado, retornando defaults."}
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "student_music_profiles"):
            return {"success": True, "profile": _STUDENT_MUSIC_PROFILE_DEFAULTS, "exists": False,
                    "note": "student_music_profiles_missing_apply_migration"}
        print(f"[music-profile] ERRO get {student_id}: {type(e).__name__}: {str(e)[:300]}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/admin/students/{student_id}/music-profile")
async def admin_student_patch_music_profile(student_id: str, payload: StudentMusicProfileUpsertRequest):
    """Upsert do Perfil Musical: atualiza apenas os campos enviados. JSONB recebem merge shallow."""
    try:
        fields: dict[str, Any] = {}
        if payload.main_instrument is not None:
            fields["main_instrument"] = payload.main_instrument or None
        if payload.other_instruments is not None:
            fields["other_instruments"] = list(payload.other_instruments or [])
        if payload.level is not None:
            allowed_levels = {"iniciante", "basico", "intermediario", "intermediario_avancado", "avancado"}
            if payload.level not in allowed_levels:
                raise HTTPException(status_code=400, detail=f"level invalido: {payload.level}")
            fields["level"] = payload.level
        if payload.experience_text is not None:
            fields["experience_text"] = payload.experience_text or None
        if payload.styles is not None:
            fields["styles"] = list(payload.styles or [])
        if payload.objectives is not None:
            fields["objectives"] = list(payload.objectives or [])
        if payload.main_objective is not None:
            fields["main_objective"] = payload.main_objective or None
        if payload.difficulties is not None:
            fields["difficulties"] = list(payload.difficulties or [])
        if payload.observations is not None:
            fields["observations"] = payload.observations or None
        if payload.skills is not None:
            fields["skills"] = payload.skills or {}
        if payload.preferences is not None:
            fields["preferences"] = payload.preferences or {}
        if payload.repertory is not None:
            fields["repertory"] = payload.repertory or {}
        if not fields:
            return {"success": True, "note": "nenhum_campo_enviado"}

        def _sync_do_upsert():
            sb = _get_supabase_client()
            existing = sb.table("student_music_profiles").select("id").eq("student_id", student_id).limit(1).execute()
            if existing.data and len(existing.data) > 0:
                row_id = existing.data[0]["id"]
                merged_fields = dict(fields)
                # Merge shallow de JSONB: campo atual (BD) UNION novo payload (payload ganha no conflito).
                cur = sb.table("student_music_profiles").select("skills,preferences,repertory,other_instruments,styles,objectives,difficulties").eq("id", row_id).limit(1).execute()
                if cur.data and len(cur.data) > 0:
                    c = cur.data[0]
                    for k in ("skills","preferences","repertory"):
                        if k in merged_fields and isinstance(c.get(k), dict) and isinstance(merged_fields[k], dict):
                            merged_fields[k] = {**(c[k] or {}), **(merged_fields[k] or {})}
                res_upd = sb.table("student_music_profiles").update(merged_fields).eq("id", row_id).execute()
                return res_upd.data[0] if res_upd.data else None
            else:
                ins = {**{"student_id": student_id}, **fields}
                # Garante que os JSONB defaults existam mesmo que nao enviados.
                ins.setdefault("other_instruments", [])
                ins.setdefault("styles", [])
                ins.setdefault("objectives", [])
                ins.setdefault("difficulties", [])
                ins.setdefault("skills", {})
                ins.setdefault("preferences", {"favorite_artists":[],"favorite_songs":[],"favorite_styles":[],"want_to_learn":[]})
                ins.setdefault("repertory", {"learning":[],"mastered":[],"planned":[]})
                res_ins = sb.table("student_music_profiles").insert(ins).execute()
                return res_ins.data[0] if res_ins.data else None

        row = await asyncio.get_event_loop().run_in_executor(ThreadPoolExecutor(max_workers=1), _sync_do_upsert)
        return {"success": True, "profile": row, "upserted": True}
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "student_music_profiles"):
            raise HTTPException(status_code=503, detail="tabela_student_music_profiles_nao_existe_aplique_migration")
        print(f"[music-profile] ERRO upsert {student_id}: {type(e).__name__}: {str(e)[:300]}")
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================================
# REPERTÓRIO DO ALUNO (Integração Perfil Musical <-> Biblioteca Musical)
# Models + 5 endpoints + scoring modular pedagógico.
# Princípios:
#   - music_songs é FONTE ÚNICA. Nunca copiamos campos da música.
#   - student_music_repertory guarda apenas student_id + song_id (UNIQUE) +
#     dados específicos do aluno (status, progresso, observacao, datas).
#   - Filtros de busca reutilizam _lib_music_query_songs_sync.
#   - Sugestões usam função modular de scoring (fácil trocar p/ IA).
# =====================================================================

class StudentRepertoryAddRequest(BaseModel):
    song_id: str
    status: Optional[str] = "planned"   # planned | learning | mastered
    observacao: Optional[str] = None
    ordem: Optional[int] = None


class StudentRepertoryUpdateRequest(BaseModel):
    status: Optional[str] = None
    progresso: Optional[int] = None     # 0..100
    observacao: Optional[str] = None
    data_inicio: Optional[str] = None   # ISO date
    data_conclusao: Optional[str] = None
    ordem: Optional[int] = None


_VALID_REPERTORY_STATUSES = {"planned", "learning", "mastered"}

# Mapa: nível textual -> posição. Usado no matching por nível.
_LEVEL_RANK: dict[str, int] = {
    "iniciante": 0, "basico": 1, "intermediario": 2,
    "intermediario_avancado": 3, "avancado": 4,
}


# ---------------------------------------------------------------------
# Scoring modular pedagógico
# ---------------------------------------------------------------------
def _calc_song_match(
    song: dict[str, Any],
    profile: dict[str, Any],
) -> tuple[int, list[str]]:
    """
    Calcula pontuação de compatibilidade entre 1 música e o Perfil Musical de 1 aluno.
    - Retorna: (score_absoluto, lista_de_motivos).
    - Modular: basta trocar essa função no futuro p/ adicionar IA real.
    - Score máximo teórico = 105 (normalizado no endpoint p/ 0..100).
    """
    score = 0
    reasons: list[str] = []

    # 1) Instrumento compatível (+30)
    song_inst_names: set[str] = set()
    if isinstance(song.get("applicable_instruments"), list):
        for it in song["applicable_instruments"]:
            if isinstance(it, dict) and it.get("name"):
                song_inst_names.add(str(it["name"]).strip().lower())
    if song.get("predominant_instrument") and isinstance(song["predominant_instrument"], dict):
        p_name = song["predominant_instrument"].get("name")
        if p_name: song_inst_names.add(str(p_name).strip().lower())
    student_main = str((profile or {}).get("main_instrument") or "").strip().lower()
    if student_main and student_main in song_inst_names:
        score += 30
        reasons.append("✓ Instrumento compatível")
    else:
        student_others = [str(x).strip().lower() for x in list((profile or {}).get("other_instruments") or []) if x]
        if any(si in song_inst_names for si in student_others):
            score += 20
            reasons.append("✓ Instrumento secundário compatível")

    # 2) Nível compatível (+20)
    song_level = str(song.get("level") or "").strip()
    student_level = str((profile or {}).get("level") or "").strip()
    if song_level in _LEVEL_RANK and student_level in _LEVEL_RANK:
        diff = _LEVEL_RANK[song_level] - _LEVEL_RANK[student_level]
        if -1 <= diff <= 0:         # mesma dificuldade ou 1 abaixo (boa revisão)
            score += 20
            reasons.append("✓ Nível adequado")
        elif diff == 1:              # 1 acima (desafio controlado)
            score += 12
            reasons.append("✓ Nível com pequeno desafio")
        elif abs(diff) >= 2 and diff < 0:
            score += 5
            reasons.append("~ Nível fácil para o aluno")
    elif not student_level and song_level == "iniciante":
        score += 10

    # 3) Estilo preferencial (+15)
    song_style = str(song.get("main_style") or "").strip().lower()
    student_styles = [str(x).strip().lower() for x in list((profile or {}).get("styles") or []) if x]
    pref_styles = [str(x).strip().lower() for x in list(((profile or {}).get("preferences") or {}).get("favorite_styles") or []) if x]
    all_pref = list(set(student_styles + pref_styles))
    if song_style and song_style in all_pref:
        score += 15
        reasons.append("✓ Estilo preferido pelo aluno")

    # 4) Objetivo compatível (+15)
    song_obj_names = set()
    for o in (song.get("objectives") or []):
        if isinstance(o, dict) and o.get("name"):
            song_obj_names.add(str(o["name"]).strip().lower())
    student_objs = [str(x).strip().lower() for x in list((profile or {}).get("objectives") or []) if x]
    student_main_obj = str((profile or {}).get("main_objective") or "").strip().lower()
    all_objs = list(set(student_objs + [student_main_obj] if student_main_obj else student_objs))
    hit = [so for so in all_objs if any(so in sn for sn in song_obj_names)]
    if hit:
        score += 15
        reasons.append("✓ Objetivo compatível")

    # 5) Habilidade compatível (+10)
    song_tec_names = set()
    for t in (song.get("techniques") or []):
        if isinstance(t, dict) and t.get("name"):
            song_tec_names.add(str(t["name"]).strip().lower())
    student_skills = (profile or {}).get("skills") or {}
    em_desenvolvimento: list[str] = []
    for cat in ("tecnica", "ritmo", "teoria"):
        for skill_name, lvl in (student_skills.get(cat) or {}).items():
            if str(lvl) in ("em_desenvolvimento", "basico"):
                # normaliza: acordes_abertos -> acordes abertos
                em_desenvolvimento.append(str(skill_name).replace("_", " ").lower())
    hit_skill = [sk for sk in em_desenvolvimento if any(sk in sn for sn in song_tec_names)]
    if hit_skill:
        score += 10
        reasons.append("✓ Trabalha habilidade em desenvolvimento")

    # 6) Dificuldade alinhada (+10)
    student_diffs = [str(x).strip().lower() for x in list((profile or {}).get("difficulties") or []) if x]
    # combina objetivos + técnicas
    objs_plus_tecs = {*song_obj_names, *song_tec_names}
    hit_diff = [d for d in student_diffs if any(d in it for it in objs_plus_tecs)]
    if hit_diff:
        score += 10
        reasons.append("✓ Trabalha ponto de dificuldade do aluno")

    # 7) Quantidade de acordes adequada (+5)
    try:
        cc = int(song.get("chord_count") or 0)
    except Exception:
        cc = 0
    if student_level == "iniciante":
        if 0 < cc <= 4:
            score += 5
            reasons.append("✓ Quantidade de acordes adequada")
    elif student_level == "basico":
        if 0 < cc <= 6:
            score += 5
            reasons.append("✓ Quantidade de acordes adequada")

    # 8) Compasso compatível (+5)
    song_ts = str(song.get("time_signature") or "").strip()
    # Se o aluno tem dificuldade "tempo" ou "ritmo" e música tem compasso conhecido, pontua levemente.
    if song_ts and any(d in song_ts for d in student_diffs if d in ("tempo", "ritmo", "compasso")):
        score += 5
        reasons.append("✓ Compasso alinhado com foco atual")

    return score, reasons


# ---------------------------------------------------------------------
# 1. GET /admin/students/{student_id}/repertory
# ---------------------------------------------------------------------
@app.get("/admin/students/{student_id}/repertory")
async def admin_student_get_repertory(student_id: str):
    """Retorna repertório do aluno com cada song HIDRATADO (não copia nada)."""
    try:
        def _sync() -> dict[str, Any]:
            sb = _build_supabase_client()
            rows = []
            try:
                r = sb.table("student_music_repertory") \
                    .select("*") \
                    .eq("student_id", student_id) \
                    .order("ordem", nulls_first=False) \
                    .order("created_at", desc=True) \
                    .execute()
                rows = list(r.data or [])
            except Exception as _q:
                if not _is_table_or_relation_missing_error(_q, "student_music_repertory"):
                    raise
                rows = []

            song_ids_raw = [str(r["song_id"]) for r in rows if r.get("song_id")]
            songs_hydrated: dict[str, dict[str, Any]] = {}
            if song_ids_raw:
                # Reutiliza helper para hidratar (instrumentos/objetivos/técnicas).
                try:
                    all_songs = _lib_music_query_songs_sync(limit=5000)
                    for s in all_songs:
                        if str(s.get("id")) in song_ids_raw:
                            songs_hydrated[str(s["id"])] = s
                except Exception as _h:
                    print(f"[repertory] WARN hidratar: {type(_h).__name__}: {str(_h)[:180]}")

            items = []
            for r in rows:
                sid = str(r.get("song_id"))
                item: dict[str, Any] = {
                    "id": r.get("id"),
                    "student_id": r.get("student_id"),
                    "song_id": sid,
                    "status": r.get("status") or "planned",
                    "progresso": int(r.get("progresso") or 0),
                    "observacao": r.get("observacao"),
                    "data_inicio": r.get("data_inicio"),
                    "data_conclusao": r.get("data_conclusao"),
                    "ordem": r.get("ordem"),
                    "created_at": r.get("created_at"),
                    "updated_at": r.get("updated_at"),
                    "song": songs_hydrated.get(sid) or {"id": sid, "title": "Música não encontrada"},
                }
                items.append(item)
            return {"items": items}

        from concurrent.futures import ThreadPoolExecutor
        import asyncio as _aio
        loop = _aio.get_running_loop()
        data = await loop.run_in_executor(ThreadPoolExecutor(max_workers=1), _sync)
        return {"success": True, **data}
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "student_music_repertory"):
            return {"success": True, "items": [], "note": "student_music_repertory_missing_apply_migration"}
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------
# 2. POST /admin/students/{student_id}/repertory
# ---------------------------------------------------------------------
@app.post("/admin/students/{student_id}/repertory")
async def admin_student_add_repertory(student_id: str, payload: StudentRepertoryAddRequest):
    """Adiciona música ao repertório (vínculo único). Retorna 409 se já existir."""
    status = (payload.status or "planned").strip().lower()
    if status not in _VALID_REPERTORY_STATUSES:
        raise HTTPException(status_code=400, detail=f"status inválido: {status}")
    if not str(payload.song_id).strip():
        raise HTTPException(status_code=400, detail="song_id é obrigatório")
    try:
        def _sync():
            sb = _build_supabase_client()
            # Verifica duplicação
            ex = sb.table("student_music_repertory") \
                .select("*") \
                .eq("student_id", student_id) \
                .eq("song_id", str(payload.song_id).strip()) \
                .limit(1).execute()
            if ex.data and len(ex.data) > 0:
                return {"already_exists": True, "row": ex.data[0]}
            ins = {
                "student_id": student_id,
                "song_id": str(payload.song_id).strip(),
                "status": status,
                "progresso": 0,
            }
            if payload.observacao is not None: ins["observacao"] = payload.observacao
            if payload.ordem is not None: ins["ordem"] = int(payload.ordem)
            r = sb.table("student_music_repertory").insert(ins).execute()
            return {"already_exists": False, "row": r.data[0] if r.data else None}

        from concurrent.futures import ThreadPoolExecutor
        import asyncio as _aio
        loop = _aio.get_running_loop()
        res = await loop.run_in_executor(ThreadPoolExecutor(max_workers=1), _sync)
        if res.get("already_exists"):
            current = res.get("row") or {}
            raise HTTPException(status_code=409, detail={
                "already_exists": True,
                "current_status": current.get("status") or "planned",
                "repertory_id": current.get("id"),
                "song_id": current.get("song_id"),
                "message": "Esta música já está no repertório deste aluno.",
            })
        return {"success": True, "added": True, "row": res.get("row")}
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e, "student_music_repertory"):
            raise HTTPException(status_code=503, detail="tabela_student_music_repertory_nao_existe_aplique_migration")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------
# 3. PATCH /admin/students/{student_id}/repertory/{song_id}
# ---------------------------------------------------------------------
@app.patch("/admin/students/{student_id}/repertory/{song_id}")
async def admin_student_patch_repertory(student_id: str, song_id: str, payload: StudentRepertoryUpdateRequest):
    try:
        if payload.status is not None and payload.status not in _VALID_REPERTORY_STATUSES:
            raise HTTPException(status_code=400, detail=f"status inválido: {payload.status}")
        if payload.progresso is not None and not (0 <= int(payload.progresso) <= 100):
            raise HTTPException(status_code=400, detail="progresso deve ser 0..100")
        def _sync():
            sb = _build_supabase_client()
            ex = sb.table("student_music_repertory") \
                .select("id") \
                .eq("student_id", student_id).eq("song_id", song_id).limit(1).execute()
            if not ex.data or len(ex.data) == 0:
                return None
            rid = ex.data[0]["id"]
            upd: dict[str, Any] = {}
            if payload.status is not None:
                upd["status"] = payload.status
                # Auto-atualiza datas em mudanças clássicas
                if payload.status == "learning" and not payload.data_inicio:
                    try:
                        from datetime import date
                        upd["data_inicio"] = date.today().isoformat()
                    except Exception:
                        pass
                if payload.status == "mastered" and not payload.data_conclusao:
                    try:
                        from datetime import date
                        upd["data_conclusao"] = date.today().isoformat()
                    except Exception:
                        pass
            if payload.progresso is not None:
                upd["progresso"] = int(payload.progresso)
            if payload.observacao is not None:
                upd["observacao"] = payload.observacao
            if payload.data_inicio is not None:
                upd["data_inicio"] = payload.data_inicio
            if payload.data_conclusao is not None:
                upd["data_conclusao"] = payload.data_conclusao
            if payload.ordem is not None:
                upd["ordem"] = int(payload.ordem)
            if not upd:
                return ex.data[0]
            r = sb.table("student_music_repertory").update(upd).eq("id", rid).execute()
            return r.data[0] if r.data else None
        from concurrent.futures import ThreadPoolExecutor
        import asyncio as _aio
        loop = _aio.get_running_loop()
        row = await loop.run_in_executor(ThreadPoolExecutor(max_workers=1), _sync)
        if not row:
            raise HTTPException(status_code=404, detail="vinculo_nao_encontrado")
        return {"success": True, "updated": True, "row": row}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------
# 4. DELETE /admin/students/{student_id}/repertory/{song_id}
# ---------------------------------------------------------------------
@app.delete("/admin/students/{student_id}/repertory/{song_id}")
async def admin_student_remove_repertory(student_id: str, song_id: str):
    try:
        def _sync():
            sb = _build_supabase_client()
            sb.table("student_music_repertory") \
                .delete() \
                .eq("student_id", student_id).eq("song_id", song_id).execute()
            return True
        from concurrent.futures import ThreadPoolExecutor
        import asyncio as _aio
        loop = _aio.get_running_loop()
        await loop.run_in_executor(ThreadPoolExecutor(max_workers=1), _sync)
        return {"success": True, "deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------
# 5. GET /admin/students/{student_id}/repertory/suggestions
# ---------------------------------------------------------------------
@app.get("/admin/students/{student_id}/repertory/suggestions")
async def admin_student_repertory_suggestions(student_id: str, limit: Optional[int] = 30):
    """Sugestões pedagógicas baseadas no Perfil Musical. Scoring modular explicável."""
    try:
        def _sync() -> dict[str, Any]:
            sb = _build_supabase_client()
            # 1) Carrega Perfil Musical do aluno
            profile = dict(_STUDENT_MUSIC_PROFILE_DEFAULTS)
            try:
                pr = sb.table("student_music_profiles") \
                    .select("*").eq("student_id", student_id).limit(1).execute()
                if pr.data and len(pr.data) > 0:
                    row = pr.data[0]
                    for k, v in row.items():
                        if k in ("id", "student_id", "created_at", "updated_at"): continue
                        if isinstance(_STUDENT_MUSIC_PROFILE_DEFAULTS.get(k), dict) and isinstance(v, dict):
                            profile[k] = {**_STUDENT_MUSIC_PROFILE_DEFAULTS[k], **v}
                        elif isinstance(_STUDENT_MUSIC_PROFILE_DEFAULTS.get(k), list) and isinstance(v, list):
                            profile[k] = v if v else _STUDENT_MUSIC_PROFILE_DEFAULTS[k]
                        else:
                            profile[k] = v if v is not None else _STUDENT_MUSIC_PROFILE_DEFAULTS.get(k)
            except Exception as _pm:
                if not _is_table_or_relation_missing_error(_pm, "student_music_profiles"):
                    raise

            # 2) Já existentes no repertório → excluir da lista (item 12)
            existing_ids: set[str] = set()
            try:
                ex = sb.table("student_music_repertory") \
                    .select("song_id").eq("student_id", student_id).execute()
                for r in (ex.data or []):
                    if r.get("song_id"):
                        existing_ids.add(str(r["song_id"]))
            except Exception as _re:
                if not _is_table_or_relation_missing_error(_re, "student_music_repertory"):
                    raise

            # 3) Todas as músicas (usando helper FONTE ÚNICA dos filtros).
            all_songs = _lib_music_query_songs_sync(
                limit=5000,
                operation_label="music:suggest:all"
            )

            # 4) Scoring para cada música + filtro exclude
            MAX_THEORETICO = 105
            candidates = []
            for s in all_songs:
                sid = str(s.get("id") or "")
                if not sid or sid in existing_ids:
                    continue
                raw, reasons = _calc_song_match(s, profile)
                # Normaliza 0..100 (inteiro → "94/100" no front)
                score_norm = min(100, max(0, int(round((raw / MAX_THEORETICO) * 100)))) if raw > 0 else 0
                if not reasons:
                    reasons.append("~ Nenhum critério específico atingido")
                candidates.append({
                    "song": s,
                    "score": score_norm,
                    "reasons": reasons,
                    "_raw": raw,
                })

            # 5) Ordena por score desc. Top N.
            candidates.sort(key=lambda x: (x["_raw"], x["score"]), reverse=True)
            top_n = candidates[: max(1, int(limit or 30))]
            # Remove campo interno
            for c in top_n:
                c.pop("_raw", None)
            # Fallback: se nenhum critério bateu e a biblioteca tem músicas,
            # devolve as primeiras 5 como "Repertório geral", com razão neutra.
            if not top_n and all_songs:
                for s in list(all_songs)[:5]:
                    sid = str(s.get("id") or "")
                    if not sid or sid in existing_ids: continue
                    top_n.append({
                        "song": s,
                        "score": 30,
                        "reasons": ["• Sugestão neutra (criterios insuficientes no perfil)"],
                    })
            return {"suggestions": top_n}

        from concurrent.futures import ThreadPoolExecutor
        import asyncio as _aio
        loop = _aio.get_running_loop()
        data = await loop.run_in_executor(ThreadPoolExecutor(max_workers=1), _sync)
        return {"success": True, **data}
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_or_relation_missing_error(e):
            return {"success": True, "suggestions": [], "note": "tabelas_nao_existem_aplique_migration"}
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)