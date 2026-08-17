import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2, 
  Upload, 
  Lock, 
  User, 
  Video, 
  Mic, 
  Filter, 
  X,
  Circle,
  Play,
  Trash2
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { supabase } from '@/lib/supabase';
import { apiFetch, apiAlert } from '@/lib/api';
import {
  resolveLessonStatus,
  subscribeStudentLessons,
  subscribeStudentExercises,
  type UnifiedLessonStatus,
  type StudentLessonRow,
  type ExerciseRow,
  type RealtimeCleanupFn,
} from '@/lib/lessonStatus';

interface LessonSubmission {
  id: string;
  title: string;
  status: UnifiedLessonStatus;
  type: 'video' | 'audio';
  exercise_video_url?: string | null;
  exercise_thumbnail_url?: string | null;
}

interface Module {
  id: string;
  title: string;
  status: 'completed' | 'pending' | 'locked';
  lessons: LessonSubmission[];
}

type InstrumentKey = 'guitarra' | 'violao' | 'teclado' | 'piano' | 'bateria' | 'baixo' | 'ukulele' | 'canto' | 'outro';

const instrumentMeta: Record<InstrumentKey, { emoji: string; label: string; gradient: string; bgImage: string }> = {
  guitarra: {
    emoji: '🎸',
    label: 'Guitarra',
    gradient: 'from-[#ef4444]/30 via-[#f97316]/20 to-transparent',
    bgImage: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=800&auto=format&fit=crop&q=70'
  },
  violao: {
    emoji: '🪕',
    label: 'Violão',
    gradient: 'from-[#b45309]/30 via-[#d97706]/20 to-transparent',
    bgImage: 'https://images.unsplash.com/photo-1525201548942-d8732f6617a0?w=800&auto=format&fit=crop&q=70'
  },
  teclado: {
    emoji: '🎹',
    label: 'Teclado',
    gradient: 'from-[#2563eb]/30 via-[#0891b2]/20 to-transparent',
    bgImage: 'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=800&auto=format&fit=crop&q=70'
  },
  piano: {
    emoji: '🎹',
    label: 'Piano',
    gradient: 'from-[#2563eb]/30 via-[#0891b2]/20 to-transparent',
    bgImage: 'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=800&auto=format&fit=crop&q=70'
  },
  bateria: {
    emoji: '🥁',
    label: 'Bateria',
    gradient: 'from-[#7c3aed]/30 via-[#9333ea]/20 to-transparent',
    bgImage: 'https://images.unsplash.com/photo-1519892300165-cb5542fb47c7?w=800&auto=format&fit=crop&q=70'
  },
  baixo: {
    emoji: '🎸',
    label: 'Baixo',
    gradient: 'from-[#16a34a]/30 via-[#15803d]/20 to-transparent',
    bgImage: 'https://images.unsplash.com/photo-1516924962500-2b4b3b99ea02?w=800&auto=format&fit=crop&q=70'
  },
  ukulele: {
    emoji: '🎶',
    label: 'Ukulele',
    gradient: 'from-[#ca8a04]/30 via-[#a16207]/20 to-transparent',
    bgImage: 'https://images.unsplash.com/photo-1607349913338-fca6f71f6d0b?w=800&auto=format&fit=crop&q=70'
  },
  canto: {
    emoji: '🎤',
    label: 'Canto',
    gradient: 'from-[#db2777]/30 via-[#be185d]/20 to-transparent',
    bgImage: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=800&auto=format&fit=crop&q=70'
  },
  outro: {
    emoji: '🎵',
    label: 'Música',
    gradient: 'from-[#0891b2]/30 via-[#0e7490]/20 to-transparent',
    bgImage: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=800&auto=format&fit=crop&q=70'
  }
};

const normalizeInstrument = (name: string): InstrumentKey => {
  const key = String(name || '').toLowerCase().trim() as InstrumentKey;
  if (instrumentMeta[key]) return key;
  if (key.includes('viol') || key.includes('acústic') || key.includes('acustic')) return 'violao';
  if (key.includes('guitarr') || key.includes('guitar')) return 'guitarra';
  if (key.includes('teclad') || key.includes('keyboard')) return 'teclado';
  if (key.includes('piano')) return 'piano';
  if (key.includes('bater') || key.includes('drum')) return 'bateria';
  if (key.includes('baix') || key.includes('bass')) return 'baixo';
  if (key.includes('uke')) return 'ukulele';
  if (key.includes('cant') || key.includes('vocal') || key.includes('voz')) return 'canto';
  return 'outro';
};

export default function EnvioScreen({ studentId }: { studentId: string }) {
  const [openModules, setOpenModules] = useState<string[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [lastVideo, setLastVideo] = useState<{ thumbnail: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedLessonForUpload, setSelectedLessonForUpload] = useState<{ id: string; title: string } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [viewExerciseModalOpen, setViewExerciseModalOpen] = useState(false);
  const [selectedExerciseForView, setSelectedExerciseForView] = useState<{ id: string; title: string; video_url: string | null } | null>(null);
  const [primaryInstrument, setPrimaryInstrument] = useState<InstrumentKey>('guitarra');
  const exerciseVideoRef = useRef<HTMLVideoElement>(null);
  const lastModulesJsonRef = useRef<string>('');
  const localMutationAtRef = useRef<number>(0);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    try {
      setLoading(true);

      // 0. Fetch Student Profile (ALL fields)
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', studentId)
        .single();
      
      console.log('[DEBUG] Perfil completo do aluno:', profileData);
      console.log('[DEBUG] Keys do perfil (EnvioScreen):', profileData ? Object.keys(profileData) : 'null');
      console.log('[DEBUG] Campo instrument raw (EnvioScreen):', profileData?.instrument);
      console.log('[DEBUG] Campo instruments raw (EnvioScreen):', (profileData as any)?.instruments);
        
        // Get instruments array from profile - column REAL is `instrument` (singular, string CSV)
        // `instruments` column DOES NOT EXIST on profiles table (PGRST204 historical error)
        let studentInstruments: string[] = [];
        if (profileData?.instrument) {
          studentInstruments = String(profileData.instrument || '')
            .split(',')
            .map(i => i.trim().toLowerCase())
            .filter(i => i.length > 0);
        }
        
        // FALLBACK: if empty, default to ['Guitarra'] (same as TeacherDashboard line 453)
        if (studentInstruments.length === 0) {
          studentInstruments = ['guitarra'];
          console.log('[DEBUG] Fallback aplicado: instrumentos vazios, usando Guitarra (EnvioScreen)');
        }
        
        console.log('[DEBUG] Instrumentos do perfil do aluno:', studentInstruments);

        // Define instrumento primario para banner dinamico
        const firstInst = studentInstruments[0] || 'guitarra';
        setPrimaryInstrument(normalizeInstrument(firstInst));
        
        // 0.5. Fetch all INSTRUMENTS (this is the correct table name - TeacherDashboard line 302 uses 'instruments')
        const { data: instrumentsData } = await supabase
          .from('instruments')
          .select('id, name');
        
        console.log('[DEBUG] Instrumentos disponíveis no banco (tabela instruments):', instrumentsData);
        
        // Find instrument IDs that match student instruments (by name)
        const studentInstrumentIds = (instrumentsData || [])
          .filter(inst => studentInstruments.includes(String(inst.name || '').toLowerCase()))
          .map(inst => inst.id);
        
        console.log('[DEBUG] IDs de instrumentos correspondentes ao aluno:', studentInstrumentIds);

        // 1. Fetch Modules and Lessons FILTERED BY INSTRUMENT - NO FALLBACK
        let modulesData: any = [];
        
        if (studentInstrumentIds.length > 0) {
          // Only fetch if we have instrument IDs to filter
          const query = supabase
            .from('modules')
            .select('*, lessons(*)')
            .order('order', { ascending: true })
            .in('instrument_id', studentInstrumentIds);
          const result = await query;
          modulesData = result.data || [];
        }
        
        console.log('[DEBUG] Módulos retornados do banco:', modulesData);
        
        // Double client-side filter for safety
        modulesData = (modulesData || []).filter((mod: any) => 
          studentInstrumentIds.includes(mod.instrument_id)
        );

        // 2. Fetch Student Lesson Access
        const { data: accessData } = await supabase
          .from('student_lessons')
          .select('*')
          .eq('student_id', studentId);

        // 3. Fetch Student Exercises
        const { data: exercisesData } = await supabase
          .from('exercises')
          .select('*')
          .eq('student_id', studentId)
          .order('created_at', { ascending: false });

        if (modulesData) {
          const assembledModules: Module[] = modulesData.map((mod: any) => {
            const moduleLessons = mod.lessons.map((lesson: any) => {
              const access = (accessData || []).find((a: any) => a.lesson_id === lesson.id) as StudentLessonRow | undefined;
              const exercise = (exercisesData || []).find((e: any) => e.lesson_id === lesson.id) as ExerciseRow | undefined;

              let status: UnifiedLessonStatus = resolveLessonStatus({ access, exercise });

              // Blindagem: sem coluna status, força uso de is_locked booleano do banco
              if (access && (access.status === undefined || access.status === null || String(access.status).trim() === '')) {
                if (access.is_completed === true) status = 'approved';
                else if (typeof access.is_locked === 'boolean') status = access.is_locked ? 'locked' : 'unlocked';
              }

              return {
                id: lesson.id,
                title: lesson.title,
                status,
                type: 'video',
                exercise_video_url: exercise?.video_url ?? exercise?.video_url ?? null,
                exercise_thumbnail_url: exercise?.thumbnail_url ?? null
              };
            });

            const allCompleted = moduleLessons.every((l: LessonSubmission) => l.status === 'approved');
            const allLocked = moduleLessons.every((l: LessonSubmission) => l.status === 'locked');
            let modStatus: Module['status'] = 'pending';
            if (allCompleted) modStatus = 'completed';
            else if (allLocked) modStatus = 'locked';

            return {
              id: mod.id,
              title: mod.title,
              status: modStatus,
              lessons: moduleLessons
            };
          });

          let shouldSet = true;
          try {
            const json = JSON.stringify(assembledModules);
            if (lastModulesJsonRef.current && lastModulesJsonRef.current === json) shouldSet = false;
            else lastModulesJsonRef.current = json;
          } catch {}
          if (shouldSet) {
            setModules(assembledModules);
            const firstPending = assembledModules.find(m => m.status === 'pending');
            if (firstPending && openModules.length === 0) setOpenModules([firstPending.id]);
          }

          const totalLessons = assembledModules.reduce((acc, m) => acc + m.lessons.length, 0);
          const completedLessons = assembledModules.reduce((acc, m) => 
            acc + m.lessons.filter(l => l.status === 'approved').length, 0
          );
          setProgress(totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0);
        }

        if (exercisesData && exercisesData.length > 0) {
          setLastVideo({ thumbnail: exercisesData[0].thumbnail_url || "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400" });
        }

      } catch (error) {
        console.error('Error fetching EnvioScreen data:', error);
      } finally {
        setLoading(false);
      }
  };

  useEffect(() => {
    lastModulesJsonRef.current = '';
    fetchData();
  }, [studentId]);

  useEffect(() => {
    const COOLDOWN_MS = 1200;
    const onLessonChange = (_payload: any) => {
      if (Date.now() - localMutationAtRef.current < COOLDOWN_MS) return;
      fetchData();
    };
    const onExerciseChange = (_payload: any) => {
      if (Date.now() - localMutationAtRef.current < COOLDOWN_MS) return;
      fetchData();
    };
    let cleanupLessons: RealtimeCleanupFn = () => {};
    let cleanupExercises: RealtimeCleanupFn = () => {};
    try {
      cleanupLessons = subscribeStudentLessons(studentId, onLessonChange);
    } catch (e) {
      console.warn('[EnvioScreen] subscribe student_lessons failed:', e);
    }
    try {
      cleanupExercises = subscribeStudentExercises(studentId, onExerciseChange);
    } catch (e) {
      console.warn('[EnvioScreen] subscribe exercises failed:', e);
    }
    const fallback = window.setInterval(() => {
      fetchData();
    }, 15000);

    return () => {
      window.clearInterval(fallback);
      cleanupLessons();
      cleanupExercises();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const toggleModule = (id: string) => {
    setOpenModules(prev => 
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    );
  };

  const getModuleHeaderStyles = (status: Module['status']) => {
    switch (status) {
      case 'completed': return "bg-[#22c55e] text-black";
      case 'pending': return "bg-[#eab308] text-black";
      case 'locked': return "bg-[#ef4444] text-white opacity-80";
    }
  };

  const MAX_UPLOAD_MB = 200;
  const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
  const MIN_UPLOAD_BYTES = 10 * 1024; // 10 KB

  const VALID_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.3gp', '.webm', '.mkv', '.avi'];
  const VALID_VIDEO_MIMES = new Set([
    'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/3gpp',
    'video/webm', 'video/x-matroska', 'video/x-msvideo', 'application/octet-stream'
  ]);

  const isValidVideoFile = (file: File): { ok: boolean; reason?: string } => {
    const name = String(file.name || '').toLowerCase();
    const mime = String(file.type || '').toLowerCase();
    const hasValidExt = VALID_VIDEO_EXTENSIONS.some(ext => name.endsWith(ext));
    const hasValidMime = !mime || VALID_VIDEO_MIMES.has(mime);

    if (!hasValidExt && !hasValidMime) {
      return { ok: false, reason: `Formato não suportado (${mime || 'desconhecido'}). Use MP4, MOV, 3GP ou WebM.` };
    }
    return { ok: true };
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const files = e.target.files;
      console.log('[Upload][FileChange] Evento recebido — files:', files ? files.length : '0', files);

      if (!files || files.length === 0) {
        console.warn('[Upload][FileChange] Nenhum arquivo retornado pelo sistema (cancelado ou bug iOS).');
        return;
      }

      const file = files[0];
      const sizeKb = Math.round(file.size / 1024);
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);

      console.log('[Upload][FileChange] Arquivo selecionado:', {
        name: file.name,
        type: file.type || '(vazio)',
        size: file.size,
        sizeKb,
        sizeMb: `${sizeMb} MB`,
        lastModified: new Date(file.lastModified).toISOString(),
      });

      // 1. Validação tamanho ZERO (bug iOS comum ao gravar câmera curta)
      if (file.size === 0) {
        alert('❌ Erro: o arquivo de vídeo veio vazio (0 bytes). Isso é um bug ocasional do iOS quando grava pela câmera. Por favor, TENTE NOVAMENTE gravando um vídeo um pouco mais longo (pelo menos 5 segundos).');
        try { (e.target as HTMLInputElement).value = ''; } catch {}
        return;
      }

      // 2. Validação tamanho MÍNIMO (10 KB)
      if (file.size < MIN_UPLOAD_BYTES) {
        alert(`❌ Erro: o arquivo de vídeo é muito pequeno (${sizeKb} KB). Por favor, grave um vídeo com pelo menos 5 segundos e tente novamente.`);
        try { (e.target as HTMLInputElement).value = ''; } catch {}
        return;
      }

      // 3. Validação tamanho MÁXIMO (200 MB)
      if (file.size > MAX_UPLOAD_BYTES) {
        alert(`O arquivo selecionado é muito pesado (${sizeMb} MB — máximo ${MAX_UPLOAD_MB} MB). Grave um vídeo mais curto (até 3 minutos) e tente novamente.`);
        try { (e.target as HTMLInputElement).value = ''; } catch {}
        return;
      }

      // 4. Validação formato (extensão + MIME)
      const fmtCheck = isValidVideoFile(file);
      if (!fmtCheck.ok) {
        alert(`❌ ${fmtCheck.reason}`);
        try { (e.target as HTMLInputElement).value = ''; } catch {}
        return;
      }

      // 5. Corrige type vazio (alguns iPhones retornam "") para garantir envio correto
      let finalFile = file;
      if (!file.type || file.type === '') {
        const name = String(file.name || '').toLowerCase();
        let inferredMime = 'video/mp4';
        if (name.endsWith('.mov') || name.endsWith('.qt')) inferredMime = 'video/quicktime';
        else if (name.endsWith('.m4v')) inferredMime = 'video/x-m4v';
        else if (name.endsWith('.3gp')) inferredMime = 'video/3gpp';
        else if (name.endsWith('.webm')) inferredMime = 'video/webm';

        console.log(`[Upload][FileChange] MIME type vazio detectado, inferindo para: ${inferredMime}`);

        try {
          finalFile = new File([file], file.name, { type: inferredMime, lastModified: file.lastModified });
        } catch (err) {
          console.warn('[Upload][FileChange] Não foi possível recriar o File com MIME correto (Safari antigo?), usando o original mesmo.', err);
        }
      }

      setSelectedFile(finalFile);
      console.log('[Upload][FileChange] ✅ Arquivo validado e armazenado. Pronto para enviar.');

    } catch (error: any) {
      console.error('[Upload][FileChange] ❌ Erro CRÍTICO ao processar arquivo:', error);
      alert(`❌ Ocorreu um erro inesperado ao selecionar o vídeo. Por favor, feche o modal e tente novamente. Detalhes: ${error?.message || String(error)}`);
      try { (e.target as HTMLInputElement).value = ''; } catch {}
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !selectedLessonForUpload || !studentId) {
      console.warn('[Upload][handleUpload] Faltando parâmetros (cancelado):', {
        hasFile: !!selectedFile,
        hasLesson: !!selectedLessonForUpload,
        hasStudentId: !!studentId,
      });
      return;
    }

    const fileSizeMb = (selectedFile.size / (1024 * 1024)).toFixed(2);
    console.log('[Upload][handleUpload] 🚀 Iniciando envio:', {
      lessonId: selectedLessonForUpload.id,
      lessonTitle: selectedLessonForUpload.title,
      studentId: studentId.slice(0, 8) + '...',
      fileName: selectedFile.name,
      fileType: selectedFile.type,
      fileSize: `${fileSizeMb} MB`,
    });

    localMutationAtRef.current = Date.now();
    setModules(prev => prev.map(mod => ({
      ...mod,
      lessons: (mod.lessons || []).map(l => l.id === selectedLessonForUpload.id
        ? { ...l, status: 'pending_review' as UnifiedLessonStatus }
        : l)
    })));

    setUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('video', selectedFile, selectedFile.name);
      formData.append('student_id', studentId);
      formData.append('lesson_id', selectedLessonForUpload.id);

      console.log('[Upload][handleUpload] FormData preparado com sucesso. Iniciando requisição HTTP POST para /upload-exercise');

      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 10;
        if (progress > 90) {
          clearInterval(interval);
          progress = 90;
        }
        setUploadProgress(Math.floor(progress));
      }, 200);

      const startTime = Date.now();
      const response = await apiFetch('/upload-exercise', {
        method: 'POST',
        body: formData
      }, { prefix: 'Falha ao enviar vídeo', jsonBody: false, bearer: true, throwOnError: false });

      const elapsedMs = Date.now() - startTime;
      console.log(`[Upload][handleUpload] Resposta recebida em ${elapsedMs}ms — HTTP ${response.status} ${response.statusText}`);

      clearInterval(interval);

      if (response.ok) {
        setUploadProgress(100);
        let resBody: any = null;
        try {
          const text = await response.text();
          resBody = text ? JSON.parse(text) : {};
          console.log('[Upload][handleUpload] Resposta body do backend:', resBody);
        } catch { resBody = {}; }

        if (resBody && typeof resBody === 'object' && resBody.warn === 'video_truncated_size_limit') {
          console.warn('[Upload][handleUpload] ⚠️ Backend truncou vídeo no limite (1.5 MB)');
          setTimeout(() => {
            alert('⚠️ Aviso: seu vídeo foi cortado no limite de 1,5 MB por ser muito longo. Para o professor receber o exercício COMPLETO, grave no máximo 2 minutos na próxima vez.\n\n✅ Mas não se preocupe! O vídeo já foi enviado com sucesso.');
            setUploadModalOpen(false);
            setSelectedFile(null);
            setSelectedLessonForUpload(null);
            fetchData();
          }, 700);
        } else {
          console.log('[Upload][handleUpload] ✅ SUCESSO! Fechando modal e atualizando lista...');
          setTimeout(async () => {
            alert('✅ Vídeo enviado com sucesso!\n\nSeu exercício já está na fila para o professor avaliar. Você receberá uma notificação quando houver feedback.');
            await fetchData();
            setUploadModalOpen(false);
            setSelectedFile(null);
            setSelectedLessonForUpload(null);
          }, 300);
        }
      } else {
        const t = await response.text().catch(() => '');
        let detail = '';
        try {
          const j = JSON.parse(t || '{}');
          detail = j?.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : '';
        } catch {}
        const msg = `❌ Falha ao enviar vídeo — HTTP ${response.status}${response.statusText ? ` (${response.statusText})` : ''}${detail ? '\n\nDetalhe: ' + detail : ''}\n\nArquivo: ${selectedFile.name} (${fileSizeMb} MB)`;
        console.error('[Upload][handleUpload] ❌ Erro HTTP do backend:', { status: response.status, statusText: response.statusText, detail, rawBody: t });
        alert(msg);
      }
    } catch (error: any) {
      console.error('[Upload][handleUpload] ❌ Erro EXCEÇÃO (fora do HTTP):', error);
      const extraMsg = error?.message ? `\n\nDetalhes técnicos: ${error.message}` : '';
      alert(`❌ Ocorreu um erro inesperado ao enviar seu vídeo. Por favor, verifique sua conexão com a internet e tente novamente.\n\nArquivo: ${selectedFile.name} (${fileSizeMb} MB)${extraMsg}`);
      try { apiAlert('Falha ao enviar vídeo', error); } catch {}
    } finally {
      setUploading(false);
      if (!uploadModalOpen) setUploadProgress(0);
    }
  };

  const handleDeleteExercise = async (lessonId: string) => {
    if (!window.confirm('Deseja excluir este treino enviado?')) return;
    localMutationAtRef.current = Date.now();
    setModules(prev => prev.map(mod => ({
      ...mod,
      lessons: (mod.lessons || []).map(l => l.id === lessonId
        ? { ...l, status: 'unlocked' as UnifiedLessonStatus, exercise_video_url: null, exercise_thumbnail_url: null, has_exercise: false }
        : l)
    })));
    try {
      await apiFetch('/admin/delete-exercise', {
        method: 'DELETE',
        body: JSON.stringify({ student_id: studentId, lesson_id: lessonId })
      }, { prefix: 'Falha ao excluir o treino', jsonBody: true, bearer: true });
      await fetchData();
    } catch (err) {
      console.error('Erro ao excluir exercício:', err);
      apiAlert('Falha ao excluir o treino', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-black">
        <div className="w-12 h-12 border-4 border-[#00C853] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-black w-full overflow-hidden relative">
      {/* Upload Modal */}
      {uploadModalOpen && selectedLessonForUpload && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-white font-bold text-xl">Enviar Vídeo</h3>
              <button onClick={() => setUploadModalOpen(false)}>
                <X className="w-6 h-6 text-white" />
              </button>
            </div>
            <p className="text-zinc-400 mb-4">{selectedLessonForUpload.title}</p>
            <div className="mb-4 p-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 flex items-start gap-3">
              <span className="text-yellow-400 text-lg leading-none shrink-0">⚠️</span>
              <p className="text-yellow-200/90 text-[0.8125rem] font-semibold leading-snug">
                Atenção: Envie vídeos com duração máxima de <strong>3 minutos</strong> (tamanho limite de <strong>{MAX_UPLOAD_MB} MB</strong>).
                Vídeos muito longos serão automaticamente comprimidos para até ~1,5 MB.
              </p>
            </div>
            {uploading ? (
              <div className="mb-4">
                <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#f97316] to-[#ef4444] transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-zinc-400 text-sm mt-2 text-center">{uploadProgress}%</p>
              </div>
            ) : selectedFile ? (
              <div className="mb-4 p-4 bg-zinc-800 rounded-xl">
                <p className="text-white font-medium truncate">{selectedFile.name}</p>
                <p className="text-zinc-500 text-sm">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                <button
                  onClick={() => {
                    setSelectedFile(null);
                    try {
                      if (cameraInputRef.current) cameraInputRef.current.value = '';
                      if (galleryInputRef.current) galleryInputRef.current.value = '';
                    } catch {}
                  }}
                  className="mt-3 text-xs text-red-400 hover:text-red-300 font-semibold"
                >
                  ✕ Remover arquivo (escolher outro)
                </button>
              </div>
            ) : (
              <div className="mb-4 space-y-3">
                {/* INPUTS OCULTOS SEPARADOS */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="video/*,.mov,.mp4,.m4v,.3gp"
                  capture="environment"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="video/*,.mov,.mp4,.m4v,.3gp,.webm,.mkv"
                  className="hidden"
                  onChange={handleFileChange}
                />

                {/* Botão 1: Gravar com Câmera */}
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed border-[#f97316]/50 rounded-xl hover:border-[#f97316] hover:bg-[#f97316]/5 transition-all active:scale-[0.98]"
                >
                  <Video className="w-10 h-10 text-[#f97316]" />
                  <div className="text-center">
                    <p className="text-[#f97316] font-bold text-sm">📷 Gravar vídeo com a câmera</p>
                    <p className="text-zinc-500 text-xs mt-0.5">Abre a câmera do celular agora</p>
                  </div>
                </button>

                {/* Botão 2: Escolher da Galeria */}
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed border-zinc-700 rounded-xl cursor-pointer hover:border-zinc-500 hover:bg-zinc-800/50 transition-all active:scale-[0.98]"
                >
                  <Upload className="w-10 h-10 text-zinc-500" />
                  <div className="text-center">
                    <p className="text-zinc-300 font-bold text-sm">🖼️ Escolher da galeria / arquivos</p>
                    <p className="text-zinc-500 text-xs mt-0.5">Selecione um vídeo já gravado</p>
                  </div>
                </button>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setUploadModalOpen(false)}
                className="flex-1 py-3 rounded-full border border-zinc-700 text-zinc-400 font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={handleUpload}
                disabled={!selectedFile || uploading}
                className="flex-1 py-3 rounded-full bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white font-bold disabled:opacity-50"
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Exercise Modal */}
      {viewExerciseModalOpen && selectedExerciseForView && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-black/80">
            <h3 className="text-white font-bold truncate">{selectedExerciseForView.title}</h3>
            <button onClick={() => { setViewExerciseModalOpen(false); if (exerciseVideoRef.current) { try { exerciseVideoRef.current.pause(); } catch (e) {} } setSelectedExerciseForView(null); }} className="p-2">
              <X className="w-6 h-6 text-white" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center bg-black">
            {selectedExerciseForView.video_url ? (
              <video
                ref={exerciseVideoRef}
                src={selectedExerciseForView.video_url}
                controls
                className="w-full h-full max-h-[70vh] object-contain"
                playsInline
              />
            ) : (
              <div className="text-zinc-400 text-center p-8">
                Sem video disponivel para este envio.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Banner Dinâmico por Instrumento */}
      <div className="relative px-4 pt-6 pb-6 overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 -z-0">
          <img
            src={instrumentMeta[primaryInstrument].bgImage}
            alt=""
            className="w-full h-full object-cover opacity-20 scale-105"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <div className={cn(
            "absolute inset-0 bg-gradient-to-br",
            instrumentMeta[primaryInstrument].gradient
          )} />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
        </div>

        <div className="relative z-10 flex items-center gap-5">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-white/10 to-white/5 border border-white/15 backdrop-blur-md flex items-center justify-center shadow-2xl flex-shrink-0 overflow-hidden">
            <span className="text-[3.5rem] leading-none drop-shadow-lg">
              {instrumentMeta[primaryInstrument].emoji}
            </span>
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-[0.6875rem] font-black uppercase tracking-widest text-zinc-400 mb-1">
              Exercícios de {instrumentMeta[primaryInstrument].label}
            </span>
            <h2 className="text-[1.375rem] font-extrabold text-white leading-tight">
              Meu Repositório de Exercícios
            </h2>
            <div className="flex items-center gap-3 mt-2">
              <div className="flex items-center gap-1.5">
                <Video className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-[0.75rem] text-zinc-400">Vídeos</span>
              </div>
              <span className="w-1 h-1 rounded-full bg-zinc-700" />
              <div className="flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-[0.75rem] text-zinc-400">Áudios</span>
              </div>
              <span className="w-1 h-1 rounded-full bg-zinc-700" />
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                <span className="text-[0.75rem] text-[#22c55e] font-bold">{progress}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Accordions de Módulos */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 pb-24">
        {modules.map((module) => (
          <div key={module.id} className="rounded-[1.25rem] overflow-hidden bg-zinc-900/30 border border-white/5">
            {/* Header do Módulo */}
            <button
              onClick={() => module.status !== 'locked' && toggleModule(module.id)}
              className={cn(
                "w-full flex items-center justify-between p-4 transition-all",
                getModuleHeaderStyles(module.status)
              )}
            >
              <div className="flex items-center gap-3">
                {module.status === 'completed' && <User className="w-5 h-5" />}
                {module.status === 'locked' && <Lock className="w-5 h-5" />}
                <span className="font-bold text-[0.9375rem]">{module.title}</span>
              </div>
              {module.status !== 'locked' && (
                openModules.includes(module.id) ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />
              )}
            </button>

            {/* Aulas do Módulo */}
            {openModules.includes(module.id) && module.status !== 'locked' && (
              <div className="p-2 space-y-2">
                {module.lessons.map((lesson) => (
                  <div key={lesson.id} className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/5">
                    <div className="flex items-center gap-3 min-w-0">
                      {lesson.status === 'locked' ? (
                        <Lock className="w-4 h-4 text-[#ef4444] flex-shrink-0" />
                      ) : (lesson.status === 'pending_review' || lesson.status === 'approved') && (lesson.exercise_video_url || lesson.exercise_thumbnail_url) ? (
                        <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 relative bg-zinc-800">
                          <img 
                            src={lesson.exercise_thumbnail_url || "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=200"} 
                            alt="Envio" 
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <Video className="w-4 h-4 text-white" />
                          </div>
                        </div>
                      ) : (
                        lesson.type === 'video' ? <Video className="w-4 h-4 text-zinc-400 flex-shrink-0" /> : <Mic className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                      )}
                      <div className="flex flex-col min-w-0">
                        <span className={cn(
                          "text-[0.875rem] font-medium truncate",
                          lesson.status === 'locked' ? "text-zinc-600" : "text-white"
                        )}>
                          {lesson.title}
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {lesson.status === 'approved' && (
                            <div className="flex items-center gap-1">
                              <span className="text-[0.6875rem] text-[#22c55e] font-bold uppercase">Concluido</span>
                              <CheckCircle2 className="w-3 h-3 text-[#22c55e] fill-[#22c55e]/10" />
                            </div>
                          )}
                          {lesson.status === 'pending_review' && (
                            <div className="flex items-center gap-1">
                              <span className="text-[0.6875rem] text-[#f97316] font-bold uppercase">Video Enviado</span>
                              <CheckCircle2 className="w-3 h-3 text-[#f97316] fill-[#f97316]/10" />
                            </div>
                          )}
                          {lesson.status === 'unlocked' && (
                            <span className="text-[0.6875rem] text-zinc-500 font-bold uppercase">Aguardando Video</span>
                          )}
                          {lesson.status === 'locked' && (
                            <span className="text-[0.6875rem] text-zinc-600 font-bold uppercase">Bloqueado</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      {lesson.status === 'approved' && (lesson.exercise_video_url ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5 text-[#22c55e]" />
                          <button
                            onClick={() => {
                              setSelectedExerciseForView({ id: lesson.id, title: lesson.title, video_url: lesson.exercise_video_url || null });
                              setViewExerciseModalOpen(true);
                            }}
                            className="px-3 py-1.5 rounded-full border border-[#22c55e] text-[#22c55e] text-[0.6875rem] font-bold active:scale-95 transition-transform flex items-center gap-1"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            Ver meu video
                          </button>
                          <button
                            onClick={() => {
                              setSelectedLessonForUpload({ id: lesson.id, title: lesson.title });
                              setUploadModalOpen(true);
                            }}
                            className="px-3 py-1.5 rounded-full border border-zinc-600 text-zinc-400 text-[0.6875rem] font-bold active:scale-95 transition-transform hover:border-zinc-500 hover:text-zinc-300"
                          >
                            Reenviar
                          </button>
                          <button
                            onClick={() => handleDeleteExercise(lesson.id)}
                            className="w-8 h-8 rounded-full border border-red-500/30 text-red-500 flex items-center justify-center active:scale-95 transition-transform hover:bg-red-500/10"
                            title="Excluir treino enviado"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-[#22c55e]" />
                      ))}
                      {lesson.status === 'pending_review' && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setSelectedExerciseForView({ id: lesson.id, title: lesson.title, video_url: lesson.exercise_video_url || null });
                              setViewExerciseModalOpen(true);
                            }}
                            className="px-3 py-1.5 rounded-full border border-[#f97316] text-[#f97316] text-[0.6875rem] font-bold active:scale-95 transition-transform flex items-center gap-1"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            Ver Envio
                          </button>
                          <button
                            onClick={() => {
                              setSelectedLessonForUpload({ id: lesson.id, title: lesson.title });
                              setUploadModalOpen(true);
                            }}
                            className="px-3 py-1.5 rounded-full border border-zinc-600 text-zinc-400 text-[0.6875rem] font-bold active:scale-95 transition-transform hover:border-zinc-500 hover:text-zinc-300"
                          >
                            Reenviar
                          </button>
                          <button
                            onClick={() => handleDeleteExercise(lesson.id)}
                            className="w-8 h-8 rounded-full border border-red-500/30 text-red-500 flex items-center justify-center active:scale-95 transition-transform hover:bg-red-500/10"
                            title="Excluir treino enviado"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      {lesson.status === 'unlocked' && (
                        <div className="flex items-center gap-2">
                          <Circle className="w-5 h-5 text-zinc-700" />
                          <button
                            onClick={() => {
                              setSelectedLessonForUpload({ id: lesson.id, title: lesson.title });
                              setUploadModalOpen(true);
                            }}
                            className="px-3 py-1.5 rounded-full border border-[#f97316] text-[#f97316] text-[0.6875rem] font-bold active:scale-95 transition-transform"
                          >
                            Enviar Video
                          </button>
                        </div>
                      )}
                      {lesson.status === 'locked' && (
                        <button disabled className="px-3 py-1.5 rounded-full border border-zinc-800 text-zinc-800 text-[0.6875rem] font-bold opacity-50">
                          Enviar Video
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Rodapé Fixo */}
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-zinc-900/90 backdrop-blur-md border-t border-white/5 flex items-center justify-between px-6 z-20">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-[#22c55e] rounded-full animate-pulse" />
          <span className="text-[0.8125rem] font-bold text-zinc-400">
            Progress <span className="text-white">({progress}/100%)</span>
          </span>
        </div>
        <button className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors">
          <span className="text-[0.8125rem] font-bold">Filtro</span>
          <Filter className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
