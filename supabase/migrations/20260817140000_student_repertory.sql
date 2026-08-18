-- =====================================================================
-- MIGRAÇÃO ADITIVA ZERO-RISCO: Relacionamento Aluno <-> Música (Repertório)
-- Princípios (Itens 1-4 do pedido):
--   a) music_songs continua FONTE ÚNICA das músicas (nunca copiamos campos).
--   b) student_music_repertory contém APENAS o vínculo + dados específicos do aluno.
--   c) UNIQUE(student_id, song_id) impede duplicação.
--   d) repertory JSONB antigo do student_music_profiles PERMANECE intacto.
-- =====================================================================

-- ============================
-- 1. TABELA PRINCIPAL
-- ============================
CREATE TABLE IF NOT EXISTS public.student_music_repertory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- VÍNCULOS FORTES
  student_id UUID NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  song_id UUID NOT NULL
    REFERENCES public.music_songs(id) ON DELETE CASCADE,

  -- UNIQUE (impede mesma música 2x no mesmo aluno)
  CONSTRAINT student_music_repertory_uniq_student_song
    UNIQUE (student_id, song_id),

  -- Status: planned (Próxima) | learning (Aprendendo) | mastered (Dominada)
  status TEXT NOT NULL
    DEFAULT 'planned'
    CHECK (status IN ('planned','learning','mastered')),

  -- Dados específicos do aluno (NUNCA na music_songs)
  progresso SMALLINT NOT NULL DEFAULT 0 CHECK (progresso BETWEEN 0 AND 100),
  observacao TEXT NULL,
  data_inicio DATE NULL,
  data_conclusao DATE NULL,
  ordem INT NULL,

  -- Auditoria
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- 2. ÍNDICES
-- ============================
CREATE INDEX IF NOT EXISTS idx_smr_student        ON public.student_music_repertory(student_id);
CREATE INDEX IF NOT EXISTS idx_smr_song           ON public.student_music_repertory(song_id);
CREATE INDEX IF NOT EXISTS idx_smr_student_status ON public.student_music_repertory(student_id, status);

-- ============================
-- 3. Trigger auto updated_at (reutiliza procedure existente trigger_set_timestamp)
-- ============================
DO $$ BEGIN
  CREATE TRIGGER smr_set_updated_at
    BEFORE UPDATE ON public.student_music_repertory
    FOR EACH ROW EXECUTE PROCEDURE public.trigger_set_timestamp();
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ============================
-- 4. ROW LEVEL SECURITY (seguro / não quebrante)
-- ============================
DO $$ BEGIN
  ALTER TABLE public.student_music_repertory ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- SELECT: próprio aluno pode ler o seu repertório; service_role / professor podem ler todos.
DO $$ BEGIN
  DROP POLICY IF EXISTS smr_teacher_or_self_select ON public.student_music_repertory;
  CREATE POLICY smr_teacher_or_self_select ON public.student_music_repertory
    FOR SELECT
    USING (
      auth.uid() = student_id
      OR auth.role() = 'service_role'
      OR current_setting('request.jwt.claim.role', true) IN ('teacher','admin','service_role')
    );
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- WRITE: apenas professor/admin/service_role. O aluno não edita direto.
DO $$ BEGIN
  DROP POLICY IF EXISTS smr_teacher_write ON public.student_music_repertory;
  CREATE POLICY smr_teacher_write ON public.student_music_repertory
    FOR ALL
    USING (
      auth.role() = 'service_role'
      OR current_setting('request.jwt.claim.role', true) IN ('teacher','admin','service_role')
    );
EXCEPTION WHEN OTHERS THEN NULL; END $$;
