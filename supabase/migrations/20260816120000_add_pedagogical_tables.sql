-- ========================================================================
-- FASE 1 - NOVAS TABELAS PEDAGÓGICAS (APENAS ADIÇÕES - NENHUMA ALTERAÇÃO NO EXISTENTE)
-- Prontuário por Instrumento | Anotações Professor | Diário de Treino | Notificações
-- ========================================================================

-- ========================================================================
-- 1) PRONTUÁRIO / MATRÍCULA - POSIÇÃO ATUAL POR INSTRUMENTO
-- ========================================================================
CREATE TABLE IF NOT EXISTS public.student_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Vínculos obrigatórios (1 matrícula = 1 aluno + 1 instrumento, NÃO DUPLICA)
    student_id UUID NOT NULL
        REFERENCES public.profiles(id)
        ON DELETE CASCADE,

    instrument_id UUID NOT NULL
        REFERENCES public.instruments(id)
        ON DELETE CASCADE,

    -- Posição atual da jornada (NULL = ainda não começou ou concluído)
    current_module_id UUID NULL
        REFERENCES public.modules(id)
        ON DELETE SET NULL,

    last_completed_lesson_id UUID NULL
        REFERENCES public.lessons(id)
        ON DELETE SET NULL,

    -- Observação livre do professor sobre a posição atual (ex: "travou na pestana F")
    position_note TEXT NULL,

    -- Metadata padrão
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- 🔒 REGRA CRÍTICA: 1 ALUNO NÃO PODE TER 2 PRONTUÁRIOS DO MESMO INSTRUMENTO
    CONSTRAINT uq_student_instrument_enrollment
        UNIQUE (student_id, instrument_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_enrollments_student
    ON public.student_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_instrument
    ON public.student_enrollments(instrument_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student_instrument
    ON public.student_enrollments(student_id, instrument_id);


-- ========================================================================
-- 2) HISTÓRICO DE ANOTAÇÕES DO PROFESSOR (prontuário textualmente)
-- ========================================================================
CREATE TABLE IF NOT EXISTS public.student_instructor_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Vínculo obrigatório ao par (aluno, instrumento)
    student_id UUID NOT NULL
        REFERENCES public.profiles(id)
        ON DELETE CASCADE,

    instrument_id UUID NOT NULL
        REFERENCES public.instruments(id)
        ON DELETE CASCADE,

    -- Quem escreveu a anotação (sempre o professor/administrador)
    instructor_id UUID NOT NULL
        REFERENCES public.profiles(id)
        ON DELETE CASCADE,

    -- Texto da anotação
    body TEXT NOT NULL,

    -- Título curto opcional
    title VARCHAR(160) NULL,

    -- Metadata padrão
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices: o query principal sempre é (student_id + instrument_id) ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_notes_student_instrument_created
    ON public.student_instructor_notes(student_id, instrument_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_instructor
    ON public.student_instructor_notes(instructor_id);


-- ========================================================================
-- 3) DIÁRIO DE TREINO DO ALUNO (consistência diária)
-- ========================================================================
CREATE TABLE IF NOT EXISTS public.practice_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Aluno que praticou (vínculo obrigatório)
    student_id UUID NOT NULL
        REFERENCES public.profiles(id)
        ON DELETE CASCADE,

    -- Data em que o treino aconteceu
    practice_date DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Duração em minutos (obrigatória - estatística de consistência)
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),

    -- Comentário opcional do aluno ("treinei a música X, acorde F")
    notes TEXT NULL,

    -- Data de criação no sistema
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices (histórico do aluno = student_id + practice_date DESC)
CREATE INDEX IF NOT EXISTS idx_practice_logs_student_date
    ON public.practice_logs(student_id, practice_date DESC);


-- ========================================================================
-- 4) NOTIFICAÇÕES EM-APP (Sininho)
-- ========================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Usuário destinatário (aluno OU professor)
    user_id UUID NOT NULL
        REFERENCES public.profiles(id)
        ON DELETE CASCADE,

    -- Título curto da notificação
    title VARCHAR(220) NOT NULL,

    -- Mensagem completa
    message TEXT NOT NULL,

    -- Flag de lida/não lida
    is_read BOOLEAN NOT NULL DEFAULT FALSE,

    -- Tipo para categorizar ícone/estilo:
    --   exercise_submitted | exercise_approved | exercise_feedback |
    --   note_added | practice_reminder | general | lesson_unlocked
    type VARCHAR(40) NOT NULL DEFAULT 'general',

    -- URL opcional para clique (ex: "/teacher/dashboard?student=X&lesson=Y")
    action_url TEXT NULL,

    -- IDs relacionais opcionais (permitem limpar/update em batch)
    related_student_id UUID NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    related_lesson_id UUID NULL REFERENCES public.lessons(id) ON DELETE CASCADE,

    -- Data de criação
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON public.notifications(user_id, created_at DESC);


-- ========================================================================
-- TRIGGERS DE updated_at AUTO (usa função moddatetime padrão do Supabase)
-- ========================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'moddatetime') THEN

        DROP TRIGGER IF EXISTS handle_enrollments_updated_at ON public.student_enrollments;
        CREATE TRIGGER handle_enrollments_updated_at
          BEFORE UPDATE ON public.student_enrollments
          FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

        DROP TRIGGER IF EXISTS handle_notes_updated_at ON public.student_instructor_notes;
        CREATE TRIGGER handle_notes_updated_at
          BEFORE UPDATE ON public.student_instructor_notes
          FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

        DROP TRIGGER IF EXISTS handle_practice_updated_at ON public.practice_logs;
        CREATE TRIGGER handle_practice_updated_at
          BEFORE UPDATE ON public.practice_logs
          FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

    END IF;
END $$;


-- ========================================================================
-- ROW LEVEL SECURITY (RLS) - HABILITA + POLÍTICAS DEFAULT DE ADMIN (service role bypass anyway)
-- ========================================================================
ALTER TABLE public.student_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_instructor_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- OBS: todas as writes do sistema são via service_role no backend FastAPI.
-- RLS aqui só serve como proteção extra caso alguém conecte o client anon direto.
-- Nenhuma policy quebrará flows core existentes (service role sempre ignora RLS).
