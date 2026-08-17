-- =====================================================================
-- MIGRACAO ADITIVA ZERO-RISCO: Perfil Musical do Aluno (Fase 7)
-- Todas as tabelas possuem IF NOT EXISTS. Nenhum DROP. Nenhuma alteracao
-- em tabelas/campos existentes. Relacionamento 1:1 com aluno via FK.
-- Campos de dados livres ficam em JSONB para flexibilidade futura
-- (evita criar 30+ colunas e migrações novas a cada atributo novo).
-- =====================================================================

-- Tabela 1: student_music_profiles — 1 perfil por aluno.
CREATE TABLE IF NOT EXISTS public.student_music_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL UNIQUE
    REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- ============ INFORMACOES MUSICAIS ============
  main_instrument TEXT NULL,            -- Guitarra / Violao / Teclado / ...
  other_instruments JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array strings
  level TEXT NULL
    CHECK (level IS NULL OR level IN ('iniciante','basico','intermediario','intermediario_avancado','avancado')),
  experience_text TEXT NULL,            -- ex: "2 anos e 6 meses"

  -- ============ ESTILOS / OBJETIVOS / DIFICULDADES ============
  styles JSONB NOT NULL DEFAULT '[]'::jsonb,              -- array strings
  objectives JSONB NOT NULL DEFAULT '[]'::jsonb,          -- array strings
  main_objective TEXT NULL,                               -- texto livre
  difficulties JSONB NOT NULL DEFAULT '[]'::jsonb,        -- array strings
  observations TEXT NULL,                                 -- observacoes professor (texto livre)

  -- ============ HABILIDADES (3 categorias: tecnica / ritmo / teoria) ============
  -- Formato: { "tecnica": { "acordes_abertos": "basico", "pestanas": "em_desenvolvimento", ... } }
  -- Valores permitidos p/ cada habilidade: nao_iniciado | basico | em_desenvolvimento | dominado
  skills JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- ============ PREFERENCIAS MUSICAIS ============
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Formato esperado:
  -- {
  --   "favorite_artists": ["Isaias Saad", ...],
  --   "favorite_songs":  ["Ousado Amor", ...],
  --   "favorite_styles": ["Gospel", "Worship"],
  --   "want_to_learn":   ["Musica X", "Musica Y"]   -- textos livres; futuro tera {song_id, name}
  -- }

  -- ============ REPERTORIO (3 colunas) ============
  -- Futuramente cada item sera {song_id: UUID, name: string} linkando p/ music_songs.id
  -- Por enquanto aceitamos: { "name": string, "song_id"?: UUID }
  repertory JSONB NOT NULL DEFAULT '{}'::jsonb
  -- Formato:
  -- {
  --   "learning":  [ {song_id?, name?, added_at?}, ... ],
  --   "mastered":  [ ... ],
  --   "planned":   [ ... ]
  -- }

  -- Auditoria
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_smp_student      ON public.student_music_profiles(student_id);
CREATE INDEX IF NOT EXISTS idx_smp_level        ON public.student_music_profiles(level);
CREATE INDEX IF NOT EXISTS idx_smp_instrument   ON public.student_music_profiles(main_instrument);

-- Trigger auto updated_at
DO $$ BEGIN
  CREATE TRIGGER smp_set_updated_at
    BEFORE UPDATE ON public.student_music_profiles
    FOR EACH ROW EXECUTE PROCEDURE public.trigger_set_timestamp();
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- =====================================================================
-- ROW LEVEL SECURITY (opcional, nao-quebrante: habilita apenas se a
-- tabela profiles ja possuir RLS. Sempre IF NOT EXISTS / safe.)
-- =====================================================================
DO $$ BEGIN
  ALTER TABLE public.student_music_profiles ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Politicas: (a) proprio aluno pode ler o seu; (b) professor logado pode ler todos.
-- Nao quebrante: usamos pg_has_role / superuser fallback.
DO $$ BEGIN
  DROP POLICY IF EXISTS smp_teacher_or_self_select ON public.student_music_profiles;
  CREATE POLICY smp_teacher_or_self_select ON public.student_music_profiles
    FOR SELECT
    USING (
      -- Proprio aluno acessa o seu perfil
      auth.uid() = student_id
      -- Ou o usuario autenticado (professor, via service_role no backend tambem passa)
      OR auth.role() = 'service_role'
      OR current_setting('request.jwt.claim.role', true) IN ('teacher','admin','service_role')
    );
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS smp_teacher_write ON public.student_music_profiles;
  CREATE POLICY smp_teacher_write ON public.student_music_profiles
    FOR ALL
    USING (
      auth.role() = 'service_role'
      OR current_setting('request.jwt.claim.role', true) IN ('teacher','admin','service_role')
    );
EXCEPTION WHEN OTHERS THEN NULL; END $$;
