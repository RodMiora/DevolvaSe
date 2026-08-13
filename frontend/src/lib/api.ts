import { supabase } from '@/lib/supabase';

const DEFAULT_PRODUCTION_API_URL = 'https://devolvase.onrender.com';
const LOCALHOST_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i;

function _resolveApiBaseUrl(): string {
  const envValue = (process.env.NEXT_PUBLIC_API_URL || '').trim();
  const candidate = (envValue || DEFAULT_PRODUCTION_API_URL).replace(/\/$/, '');

  // Runtime blindagem: se app NAO estiver rodando em localhost/127.0.0.1 (ex: Vercel, celular, rede LAN),
  // jamais usar localhost como API — cai direto no endereco HTTPS de producao do Render.
  // Isso evita "Load failed" no mobile quando a env nao esta definida corretamente.
  let isBrowserLocalhost = false;
  if (typeof window !== 'undefined') {
    const h = window.location.hostname.toLowerCase();
    isBrowserLocalhost = (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '[::1]');
  }

  if (!isBrowserLocalhost && LOCALHOST_PATTERN.test(candidate)) {
    console.warn(
      '[api] NEXT_PUBLIC_API_URL aponta para localhost mas o app esta rodando fora do PC. Usando fallback seguro:',
      DEFAULT_PRODUCTION_API_URL
    );
    return DEFAULT_PRODUCTION_API_URL;
  }
  return candidate;
}

export const API_BASE_URL: string = _resolveApiBaseUrl();

export async function getApiBearerToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch (e) {
    console.warn('[api] getSession failed:', e);
    return null;
  }
}

export async function getApiHeaders(opts: { json?: boolean; bearer?: boolean; custom?: Record<string, string> } = {}): Promise<Record<string, string>> {
  const { json = true, bearer = true, custom } = opts;
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (bearer) {
    const token = await getApiBearerToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  if (custom) {
    for (const k of Object.keys(custom)) {
      headers[k] = custom[k];
    }
  }
  return headers;
}

export function formatApiError(opts: { prefix: string; err?: unknown; response?: Response | null; detailFallback?: string; url?: string }): string {
  const { prefix, err, response, detailFallback, url } = opts;
  const parts: string[] = [];
  if (response?.status) parts.push(`HTTP ${response.status}${response.statusText ? ` (${response.statusText})` : ''}`);
  if (detailFallback) parts.push(detailFallback);
  if (err) {
    if (err instanceof Error && err.message && !detailFallback) parts.push(err.message);
  }
  if (url) parts.push(`URL: ${url}`);
  return `${prefix}${parts.length > 0 ? ' — ' + parts.join(' | ') : ''}`;
}

export async function extractDetailText(resp: Response): Promise<string> {
  try {
    const t = await resp.clone().text();
    if (!t) return '';
    try {
      const j = JSON.parse(t);
      if (j?.detail) {
        return typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
      }
      if (j?.error) {
        return typeof j.error === 'string' ? j.error : JSON.stringify(j.error);
      }
      if (j?.message) {
        return typeof j.message === 'string' ? j.message : JSON.stringify(j.message);
      }
      return t.slice(0, 280);
    } catch {
      return t.slice(0, 280);
    }
  } catch {
    return '';
  }
}

export async function apiFetch(
  endpoint: string,
  init: RequestInit = {},
  opts: { bearer?: boolean; jsonBody?: boolean; prefix?: string; throwOnError?: boolean } = {}
): Promise<Response> {
  const { bearer = true, jsonBody = true, prefix = 'Erro', throwOnError = true } = opts;
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  const headers = new Headers(init.headers || {});
  if (bearer) {
    const token = await getApiBearerToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  if (jsonBody) {
    const body = init.body;
    const isBinaryLike =
      body instanceof FormData ||
      body instanceof Blob ||
      body instanceof ArrayBuffer ||
      ArrayBuffer.isView(body) ||
      (typeof body === 'object' && body !== null && typeof (body as any).getReader === 'function');

    if (!isBinaryLike) {
      // Auto-stringify objetos literais e arrays para JSON (evita [object Object] no body)
      if (body !== null && body !== undefined && typeof body === 'object') {
        init = { ...init, body: JSON.stringify(body) };
      }
      // Sempre define Content-Type: application/json para bodies textuais/stringificados,
      // exceto se o caller explicitamente já definiu outro content-type.
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }
  }
  try {
    const response = await fetch(url, {
      credentials: 'include',
      ...init,
      headers,
    });
    if (throwOnError && !response.ok) {
      const detail = await extractDetailText(response);
      throw new Error(formatApiError({ prefix, response, detailFallback: detail, url }));
    }
    return response;
  } catch (err) {
    // Erros de rede (TypeError: Load failed / Failed to fetch / NetworkError) nao tem status HTTP,
    // entao garantimos que a URL alvo apareca para diagnosticar (localhost vs Render).
    if (err instanceof Error) {
      const enriched = formatApiError({ prefix, err, detailFallback: err.message, url });
      err.message = enriched.replace(`${prefix} — `, '').replace(`${prefix} —`, '');
      if (!err.message) err.message = formatApiError({ prefix, url }).replace(`${prefix} — `, '');
    }
    if (throwOnError) throw err;
    throw err;
  }
}

export function apiAlert(prefix: string, err: unknown): string {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Erro de rede ou conexão com o servidor';
  const final = `${prefix} — ${msg}`;
  alert(final);
  return final;
}
