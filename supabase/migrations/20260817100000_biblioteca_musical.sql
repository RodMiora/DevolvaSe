-- ================================================================
-- BIBLIOTECA MUSICAL - Repositório Pedagógico de Repertório
-- Data: 2026-08-17 10:00:00
-- Observação: Tudo com IF NOT EXISTS (padrão aditivo zero-risco).
-- ================================================================

DO $$ BEGIN

-- ============================
-- 1. TABELA PRINCIPAL: SONS
-- ============================
IF NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'music_songs'
) THEN
  CREATE TABLE public.music_songs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    title TEXT NOT NULL,
    artist TEXT,
    composer TEXT,
    year INT,
    description TEXT,

    main_style TEXT,
    sub_style TEXT,
    time_signature TEXT,
    bpm INT,
    original_key TEXT,

    predominant_instrument_id UUID,
    level TEXT CHECK (level IN ('iniciante','basico','intermediario','intermediario_avancado','avancado')),

    rhythm_complexity TEXT CHECK (rhythm_complexity IN ('baixa','media','alta')) DEFAULT 'media',
    harmonic_complexity TEXT CHECK (harmonic_complexity IN ('baixa','media','alta')) DEFAULT 'media',
    technical_complexity TEXT CHECK (technical_complexity IN ('baixa','media','alta')) DEFAULT 'media',

    chord_count INT DEFAULT 0,
    chords_list TEXT[] DEFAULT '{}',
    has_barre_chord BOOLEAN DEFAULT FALSE,
    has_7th_chords BOOLEAN DEFAULT FALSE,
    has_extended_chords BOOLEAN DEFAULT FALSE,
    chords_text TEXT,

    lyrics_chords TEXT,
    listen_url TEXT,

    FOREIGN KEY (predominant_instrument_id) REFERENCES public.instruments(id) ON DELETE SET NULL
  );

  CREATE INDEX idx_music_songs_title_trgm ON public.music_songs USING gin (to_tsvector('simple', COALESCE(title, '') || ' ' || COALESCE(artist, '')));
  CREATE INDEX idx_music_songs_level ON public.music_songs(level);
  CREATE INDEX idx_music_songs_chord_count ON public.music_songs(chord_count);
  CREATE INDEX idx_music_songs_time_signature ON public.music_songs(time_signature);
  CREATE INDEX idx_music_songs_style ON public.music_songs(main_style);
  CREATE INDEX idx_music_songs_predominant_inst ON public.music_songs(predominant_instrument_id);
END IF;

-- ============================
-- 2. TABELAS DE CATÁLOGO (M:N)
-- ============================

IF NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'music_pedagogical_objectives'
) THEN
  CREATE TABLE public.music_pedagogical_objectives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
END IF;

IF NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'music_techniques'
) THEN
  CREATE TABLE public.music_techniques (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE,
    category TEXT DEFAULT 'geral',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
END IF;

-- ============================
-- 3. TABELAS DE LIGAÇÃO (N:N)
-- ============================

IF NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'music_song_applicable_instruments'
) THEN
  CREATE TABLE public.music_song_applicable_instruments (
    song_id UUID NOT NULL REFERENCES public.music_songs(id) ON DELETE CASCADE,
    instrument_id UUID NOT NULL REFERENCES public.instruments(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (song_id, instrument_id)
  );
  CREATE INDEX idx_msai_instrument ON public.music_song_applicable_instruments(instrument_id);
END IF;

IF NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'music_song_objectives'
) THEN
  CREATE TABLE public.music_song_objectives (
    song_id UUID NOT NULL REFERENCES public.music_songs(id) ON DELETE CASCADE,
    objective_id UUID NOT NULL REFERENCES public.music_pedagogical_objectives(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (song_id, objective_id)
  );
  CREATE INDEX idx_mso_objective ON public.music_song_objectives(objective_id);
END IF;

IF NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'music_song_techniques'
) THEN
  CREATE TABLE public.music_song_techniques (
    song_id UUID NOT NULL REFERENCES public.music_songs(id) ON DELETE CASCADE,
    technique_id UUID NOT NULL REFERENCES public.music_techniques(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (song_id, technique_id)
  );
  CREATE INDEX idx_mst_technique ON public.music_song_techniques(technique_id);
END IF;

-- ============================
-- 4. FAVORITOS (Por professor)
-- ============================

IF NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'music_song_favorites'
) THEN
  CREATE TABLE public.music_song_favorites (
    song_id UUID NOT NULL REFERENCES public.music_songs(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (song_id, teacher_id)
  );
  CREATE INDEX idx_msf_teacher ON public.music_song_favorites(teacher_id);
END IF;

-- =====================================================================
-- 5. SEED: OBJETIVOS PEDAGÓGICOS (padronizados, NÃO DUPLICAR)
-- =====================================================================

-- seed: objetivos
IF EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'music_pedagogical_objectives'
) THEN
  INSERT INTO public.music_pedagogical_objectives (name, slug) VALUES
    ('Troca de acordes', 'troca-acordes')
    ,('Formação de acordes', 'formacao-acordes')
    ,('Pulsação', 'pulsacao')
    ,('Ritmo', 'ritmo')
    ,('Compasso 4/4', 'compasso-4-4')
    ,('Compasso 3/4', 'compasso-3-4')
    ,('Compasso 6/8', 'compasso-6-8')
    ,('Coordenação', 'coordenacao')
    ,('Independência', 'independencia')
    ,('Dinâmica', 'dinamica')
    ,('Dedilhado', 'dedilhado')
    ,('Batida', 'batida')
    ,('Palhetada', 'palhetada')
    ,('Pestana', 'pestana')
    ,('Power Chords', 'power-chords')
    ,('Escalas', 'escalas')
    ,('Improvisação', 'improvisacao')
    ,('Groove', 'groove')
    ,('Viradas', 'viradas')
    ,('Arpejos', 'arpejos')
    ,('Acompanhamento', 'acompanhamento')
    ,('Percepção rítmica', 'percepcao-ritmica')
    ,('Percepção melódica', 'percepcao-melodica')
    ,('Harmonia', 'harmonia')
    ,('Campo harmônico', 'campo-harmonico')
    ,('Inversões', 'inversoes')
    ,('Leitura', 'leitura')
    ,('Técnica de mão direita', 'tecnica-mao-direita')
    ,('Técnica de mão esquerda', 'tecnica-mao-esquerda')
  ON CONFLICT (name) DO NOTHING;
END IF;

-- seed: técnicas
IF EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'music_techniques'
) THEN
  INSERT INTO public.music_techniques (name, slug, category) VALUES
    -- VIOLÃO / CORDAS GERAL
    ('Batida', 'batida', 'violao')
    ,('Dedilhado', 'dedilhado', 'violao')
    ,('Pestana', 'pestana', 'violao')
    ,('Arpejo', 'arpejo', 'violao')
    ,('Acordes', 'acordes', 'violao')
    ,('Rasgueado', 'rasgueado', 'violao')
    ,('Fingerstyle', 'fingerstyle', 'violao')
    ,('Strumming', 'strumming', 'violao')
    -- GUITARRA
    ,('Palhetada alternada', 'palhetada-alternada', 'guitarra')
    ,('Bends', 'bends', 'guitarra')
    ,('Slides', 'slides', 'guitarra')
    ,('Hammer-on', 'hammer-on', 'guitarra')
    ,('Pull-off', 'pull-off', 'guitarra')
    ,('Legato', 'legato', 'guitarra')
    ,('Power Chords', 'power-chords-gtr', 'guitarra')
    ,('Pentatônica', 'pentatonica', 'guitarra')
    ,('Vibrato', 'vibrato', 'guitarra')
    ,('Tapping', 'tapping', 'guitarra')
    ,('Sweep picking', 'sweep-picking', 'guitarra')
    ,('Arpejos (guitarra)', 'arpejos-guitarra', 'guitarra')
    -- BATERIA
    ,('Groove', 'groove-bateria', 'bateria')
    ,('Coordenação', 'coordenacao-bateria', 'bateria')
    ,('Independência', 'independencia-bateria', 'bateria')
    ,('Viradas', 'viradas-bateria', 'bateria')
    ,('Ghost notes', 'ghost-notes', 'bateria')
    ,('Dinâmica', 'dinamica-bateria', 'bateria')
    ,('Fills', 'fills', 'bateria')
    ,('Rudimentos', 'rudimentos', 'bateria')
    -- BAIXO
    ,('Slap', 'slap-baixo', 'baixo')
    ,('Walking bass', 'walking-bass', 'baixo')
    ,('Articulação', 'articulacao-baixo', 'baixo')
    -- TECLADO / PIANO
    ,('Independência mãos', 'independencia-maos-teclado', 'teclado')
    ,('Arpejos (teclado)', 'arpejos-teclado', 'teclado')
    ,('Campo harmônico', 'campo-harmonico-teclado', 'teclado')
    -- VOZ
    ,('Aquecimento vocal', 'aquecimento-vocal', 'canto')
    ,('Respiração', 'respiracao-canto', 'canto')
    ,('Projeção', 'projecao-canto', 'canto')
    -- UKULELE
    ,('Batida (ukulele)', 'batida-ukulele', 'ukulele')
    ,('Strumming (ukulele)', 'strumming-ukulele', 'ukulele')
    -- Geral
    ,('Leitura rítmica', 'leitura-ritmica', 'geral')
    ,('Leitura melódica', 'leitura-melodica', 'geral')
    ,('Percepção', 'percepcao', 'geral')
    ,('Afinação', 'afinacao', 'geral')
  ON CONFLICT (name) DO NOTHING;
END IF;

END $$;
