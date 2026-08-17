import React, { useState, useEffect, useRef, useCallback } from "react";
import { Play, CheckCircle2, Lock, MessageSquare, Send, X, Upload, Clock, Unlock, Dumbbell, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useTabNavigation } from "./TabNavigationContext";
import {
  resolveLessonStatus,
  subscribeStudentLessons,
  subscribeStudentExercises,
  type RealtimeCleanupFn,
  type StudentLessonRow,
  type ExerciseRow,
} from "@/lib/lessonStatus";
import { apiFetch, apiAlert, extractDetailText } from "@/lib/api";

interface Lesson {
  id: string;
  title: string;
  description: string;
  video_url: string | null;
  thumbnail_url: string | null;
  thumbnail: string;
  duration: string;
  status: "locked" | "unlocked" | "pending_review" | "approved";
  exercise_video_url?: string | null;
  exercise_thumbnail_url?: string | null;
  has_exercise?: boolean;
}

export default function LessonsScreen({
  studentName,
  instrument,
}: {
  studentName: string;
  instrument: string;
}) {
  const { navigateToTab } = useTabNavigation();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoThumbnails, setVideoThumbnails] = useState<Record<string, string>>({});
  const [videoDurations, setVideoDurations] = useState<Record<string, string>>({});
  const [thumbLoaded, setThumbLoaded] = useState<Record<string, boolean>>({});
  const [thumbFailed, setThumbFailed] = useState<Record<string, boolean>>({});
  const thumbVideoRefs = useRef<Record<string, HTMLVideoElement>>({});
  const [viewingStudentVideo, setViewingStudentVideo] = useState(false);

  const formatDuration = (seconds: number): string => {
    if (!isFinite(seconds) || seconds <= 0) return "--:--";
    const s = Math.floor(seconds);
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  const setDurationForLesson = (lessonId: string, seconds: number) => {
    setVideoDurations(prev => {
      if (prev[lessonId]) return prev;
      return { ...prev, [lessonId]: formatDuration(seconds) };
    });
  };

  const generateThumbnail = (lessonId: string, videoUrl: string) => {
    // Avoid re-generating if already in state
    if (videoThumbnails[lessonId]) return;

    // Timeout de seguranca: se o video demorar demais (>8s) para gerar,
    // abandona e usa o fallback de imagem estatica / gradiente.
    const timeoutId = window.setTimeout(() => {
      setThumbFailed(prev => prev[lessonId] ? prev : { ...prev, [lessonId]: true });
    }, 8000);

    // Create a hidden video element to capture a frame
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'metadata';
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    
    video.addEventListener('loadedmetadata', () => {
      // Extrai duracao real do video dinamicamente via evento onLoadedMetadata
      if (isFinite(video.duration) && video.duration > 0) {
        setDurationForLesson(lessonId, video.duration);
      }
      try {
        // Seek mais cedo no video (0.3s por padrão) — evita fade-in inicial preto
        const seekTime = Math.min(0.3, Math.max(0.1, (video.duration || 5) * 0.02));
        video.currentTime = seekTime;
      } catch (e) {
        // ignore seek errors
      }
    });

    video.addEventListener('seeked', () => {
      window.clearTimeout(timeoutId);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        const ctx = canvas.getContext('2d');
        if (ctx && canvas.width > 0 && canvas.height > 0) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          // Detecta frame todo preto, mas com threshold BEM BAIXO (luminancia < 3)
          // para NAO rejeitar videos noturnos ou de baixa luz que ainda sao validos
          try {
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const d = imgData.data;
            let total = 0;
            let samples = 0;
            for (let i = 0; i < d.length; i += 320 * 4) {
              const r = d[i], g = d[i+1], b = d[i+2];
              total += 0.299*r + 0.587*g + 0.114*b;
              samples++;
            }
            const avgLum = samples > 0 ? total / samples : 255;
            if (avgLum < 3) {
              // Frame realmente preto puro — marca falha p/ usar fallback
              setThumbFailed(prev => ({ ...prev, [lessonId]: true }));
              return;
            }
          } catch { /* CORS bloquou getImageData — aceita a thumbnail de qualquer forma */ }

          const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
          setVideoThumbnails(prev => ({
            ...prev,
            [lessonId]: dataUrl
          }));
          setThumbLoaded(prev => ({ ...prev, [lessonId]: true }));
          setThumbFailed(prev => {
            if (!prev[lessonId]) return prev;
            const copy = { ...prev };
            delete copy[lessonId];
            return copy;
          });
        }
      } catch (e) {
        console.warn('Erro ao gerar miniatura:', e);
        setThumbFailed(prev => ({ ...prev, [lessonId]: true }));
      } finally {
        try { video.pause(); } catch (e) {}
        try { video.src = ''; } catch (e) {}
      }
    });

    video.addEventListener('error', () => {
      window.clearTimeout(timeoutId);
      setThumbFailed(prev => ({ ...prev, [lessonId]: true }));
    });
  };

  const [studentId, setStudentId] = useState<string | null>(null);
  const lastLessonsJsonRef = useRef<string>('');
  const localMutationAtRef = useRef<number>(0);

  // =====================================================================
  // FASE 3 - DIÁRIO DE TREINO (States + Types + Callbacks)
  // =====================================================================
  type PracticeLogRow = {
    id: string;
    student_id: string;
    practice_date: string;
    duration_minutes: number;
    notes: string | null;
    created_at: string;
    updated_at: string;
  };
  const [showPracticeModal, setShowPracticeModal] = useState(false);
  const [practiceMinutes, setPracticeMinutes] = useState<number>(30);
  const [practiceNotes, setPracticeNotes] = useState<string>("");
  const [practiceSaving, setPracticeSaving] = useState(false);
  const [recentPracticeLogs, setRecentPracticeLogs] = useState<PracticeLogRow[]>([]);
  const [practiceLogsLoading, setPracticeLogsLoading] = useState(false);
  const practiceLastFetchKeyRef = useRef<string>("");

  const loadPracticeLogs = useCallback(async (force = false) => {
    if (!studentId) return;
    const key = `${studentId}`;
    if (!force && practiceLastFetchKeyRef.current === key && recentPracticeLogs.length > 0) return;
    practiceLastFetchKeyRef.current = key;
    setPracticeLogsLoading(true);
    try {
      const res = await apiFetch(`/student/practice-logs/${encodeURIComponent(studentId)}?limit=14`, {
        method: 'GET',
      }, { bearer: true, jsonBody: false, prefix: 'Erro ao carregar histórico de treinos', throwOnError: false });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setRecentPracticeLogs(Array.isArray(data?.practice_logs) ? data.practice_logs : []);
      } else {
        setRecentPracticeLogs([]);
      }
    } catch (e) {
      console.warn('[Lessons] loadPracticeLogs erro:', e);
      setRecentPracticeLogs([]);
    } finally {
      setPracticeLogsLoading(false);
    }
  }, [studentId, recentPracticeLogs.length]);

  const handleSavePractice = useCallback(async () => {
    if (!studentId) return;
    if (!practiceMinutes || practiceMinutes <= 0) {
      alert('⚠️ Informe uma duração válida maior que zero.');
      return;
    }
    setPracticeSaving(true);
    try {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const practiceDate = `${yyyy}-${mm}-${dd}`;

      const res = await apiFetch('/student/practice-logs', {
        method: 'POST',
        body: {
          student_id: studentId,
          duration_minutes: practiceMinutes,
          notes: practiceNotes.trim() || null,
          practice_date: practiceDate,
        },
      }, { bearer: true, jsonBody: true, prefix: 'Erro ao registrar treino', throwOnError: false });

      if (res.ok) {
        alert('✅ Treino registrado com sucesso!');
        setPracticeMinutes(30);
        setPracticeNotes("");
        setShowPracticeModal(false);
        loadPracticeLogs(true);
      } else {
        const detail = await extractDetailText(res).catch(() => '');
        apiAlert('Erro ao registrar treino', detail || 'Tente novamente.');
      }
    } catch (e) {
      apiAlert('Erro ao registrar treino', e);
    } finally {
      setPracticeSaving(false);
    }
  }, [studentId, practiceMinutes, practiceNotes, loadPracticeLogs]);

  const practiceStats = (() => {
    const logs = recentPracticeLogs || [];
    if (!logs.length) return { totalMin: 0, last7Min: 0, streak: 0, todayDone: false };
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const todayDone = logs.some(l => l.practice_date === todayStr);
    let last7Min = 0;
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6); weekAgo.setHours(0,0,0,0);
    for (const l of logs) {
      const d = new Date(l.practice_date + 'T00:00:00');
      if (d >= weekAgo) { last7Min += l.duration_minutes || 0; }
    }
    let streak = 0;
    const cursor = new Date(); cursor.setHours(0,0,0,0);
    const dateSet = new Set(logs.map(l => l.practice_date));
    for (let i = 0; i < 60; i++) {
      const yyyy = cursor.getFullYear();
      const mm = String(cursor.getMonth()+1).padStart(2,'0');
      const dd = String(cursor.getDate()).padStart(2,'0');
      const key = `${yyyy}-${mm}-${dd}`;
      if (dateSet.has(key)) { streak++; cursor.setDate(cursor.getDate() - 1); }
      else { if (i === 0) { cursor.setDate(cursor.getDate() - 1); continue; } break; }
    }
    return { totalMin: logs.reduce((s,l) => s + (l.duration_minutes||0), 0), last7Min, streak, todayDone };
  })();

  useEffect(() => {
    const fetchLessons = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setStudentId(user.id);
        // 0. Fetch Student Profile (ALL fields)
        const { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        
        console.log('[DEBUG] Perfil completo do aluno (Lessons):', profileData);
        console.log('[DEBUG] Keys do perfil (Lessons):', profileData ? Object.keys(profileData) : 'null');
        console.log('[DEBUG] Campo instrument raw (Lessons):', profileData?.instrument);
        console.log('[DEBUG] Campo instruments raw (Lessons):', (profileData as any)?.instruments);
        
        let studentInstruments: string[] = [];
        if (profileData?.instrument) {
          studentInstruments = String(profileData.instrument || '')
            .split(',')
            .map(i => i.trim().toLowerCase())
            .filter(i => i.length > 0);
        }
        
        if (studentInstruments.length === 0) {
          studentInstruments = ['guitarra'];
          console.log('[DEBUG] Fallback aplicado: instrumentos vazios, usando Guitarra (Lessons)');
        }
        
        console.log('[DEBUG] Instrumentos do perfil do aluno (Lessons):', studentInstruments);
        
        const { data: instrumentsData } = await supabase
          .from('instruments')
          .select('id, name');
        
        console.log('[DEBUG] Instrumentos disponíveis no banco (Lessons):', instrumentsData);
        
        const studentInstrumentIds = (instrumentsData || [])
          .filter(inst => studentInstruments.includes(String(inst.name || '').toLowerCase()))
          .map(inst => inst.id);
        
        console.log('[DEBUG] IDs de instrumentos correspondentes ao aluno (Lessons):', studentInstrumentIds);

        let modulesData: any = [];
        
        if (studentInstrumentIds.length > 0) {
          const query = supabase
            .from('modules')
            .select('*, lessons(*)')
            .order('order', { ascending: true })
            .in('instrument_id', studentInstrumentIds);
          const result = await query;
          modulesData = result.data || [];
        }
        
        console.log('[DEBUG] Módulos retornados do banco (Lessons):', modulesData);
        
        modulesData = (modulesData || []).filter((mod: any) => 
          studentInstrumentIds.includes(mod.instrument_id)
        );

        const { data: accessData } = await supabase
          .from('student_lessons')
          .select('*')
          .eq('student_id', user.id);

        const { data: exercisesData } = await supabase
          .from('exercises')
          .select('*')
          .eq('student_id', user.id);

        if (modulesData) {
          const allLessons: Lesson[] = [];
          modulesData.forEach((mod: any) => {
            (mod.lessons || []).forEach((lesson: any) => {
              const access = (accessData || []).find((a: any) => a.lesson_id === lesson.id) as StudentLessonRow | undefined;
              const exercise = (exercisesData || []).find((e: any) => e.lesson_id === lesson.id) as ExerciseRow | undefined;

              let status = resolveLessonStatus({ access, exercise });
              // Blindagem: sem coluna status no banco, usa booleano is_locked (prioridade)
              if (access && (access.status === undefined || access.status === null || String(access.status).trim() === '')) {
                if (access.is_completed === true) status = 'approved';
                else if (typeof access.is_locked === 'boolean') status = access.is_locked ? 'locked' : 'unlocked';
              }

              allLessons.push({
                id: lesson.id,
                title: lesson.title,
                description: lesson.description || '',
                video_url: lesson.video_url,
                thumbnail_url: lesson.thumbnail_url || null,
                thumbnail: lesson.thumbnail_url || "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400",
                duration: "5:00",
                status,
                exercise_video_url: exercise?.video_url ?? null,
                exercise_thumbnail_url: exercise?.thumbnail_url ?? null,
                has_exercise: !!exercise
              });
            });
          });
          try {
            const json = JSON.stringify(allLessons);
            if (lastLessonsJsonRef.current && lastLessonsJsonRef.current === json) {
              // Skip set state to avoid re-renders when realtime returns same data
            } else {
              lastLessonsJsonRef.current = json;
              setLessons(allLessons);
            }
          } catch {
            setLessons(allLessons);
          }

          allLessons.forEach((lesson, idx) => {
            if (!lesson.thumbnail_url && lesson.video_url && idx < 2) {
              generateThumbnail(lesson.id, lesson.video_url);
            }
          });
        }
      } catch (error) {
        console.error('Error fetching lessons:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLessons();
  }, []);

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    const COOLDOWN_MS = 1200;
    const didInitialMountRef = { current: false };

    const refetchLessons = async (fromRemote: boolean = false) => {
      if (cancelled) return;
      if (fromRemote && Date.now() - localMutationAtRef.current < COOLDOWN_MS) {
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      try {
        // NAO setar loading=true apos o primeiro carregamento.
        // Evita o "circulo de atualizando" aparecer sozinho no mobile.
        if (!didInitialMountRef.current) {
          setLoading(true);
        }

        const { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        let studentInstruments: string[] = [];
        if (profileData?.instrument) {
          studentInstruments = String(profileData.instrument || '')
            .split(',')
            .map(i => i.trim().toLowerCase())
            .filter(i => i.length > 0);
        }
        if (studentInstruments.length === 0) studentInstruments = ['guitarra'];

        const { data: instrumentsData } = await supabase
          .from('instruments')
          .select('id, name');

        const studentInstrumentIds = (instrumentsData || [])
          .filter(inst => studentInstruments.includes(String(inst.name || '').toLowerCase()))
          .map(inst => inst.id);

        let modulesData: any = [];
        if (studentInstrumentIds.length > 0) {
          const result = await supabase
            .from('modules')
            .select('*, lessons(*)')
            .order('order', { ascending: true })
            .in('instrument_id', studentInstrumentIds);
          modulesData = result.data || [];
        }
        modulesData = (modulesData || []).filter((mod: any) =>
          studentInstrumentIds.includes(mod.instrument_id)
        );

        const { data: accessData } = await supabase
          .from('student_lessons')
          .select('*')
          .eq('student_id', user.id);

        const { data: exercisesData } = await supabase
          .from('exercises')
          .select('*')
          .eq('student_id', user.id);

        if (modulesData) {
          const allLessons: Lesson[] = [];
          modulesData.forEach((mod: any) => {
            (mod.lessons || []).forEach((lesson: any) => {
              const access = (accessData || []).find((a: any) => a.lesson_id === lesson.id) as StudentLessonRow | undefined;
              const exercise = (exercisesData || []).find((e: any) => e.lesson_id === lesson.id) as ExerciseRow | undefined;

              let status = resolveLessonStatus({ access, exercise });
              // Blindagem: sem coluna status no banco, usa booleano is_locked (prioridade)
              if (access && (access.status === undefined || access.status === null || String(access.status).trim() === '')) {
                if (access.is_completed === true) status = 'approved';
                else if (typeof access.is_locked === 'boolean') status = access.is_locked ? 'locked' : 'unlocked';
              }

              allLessons.push({
                id: lesson.id,
                title: lesson.title,
                description: lesson.description || '',
                video_url: lesson.video_url,
                thumbnail_url: lesson.thumbnail_url || null,
                thumbnail: lesson.thumbnail_url || "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400",
                duration: "5:00",
                status,
                exercise_video_url: exercise?.video_url ?? null,
                exercise_thumbnail_url: exercise?.thumbnail_url ?? null,
                has_exercise: !!exercise
              });
            });
          });
          if (!cancelled) {
            setLessons(prev => {
              if (JSON.stringify(prev) === JSON.stringify(allLessons)) return prev;
              return allLessons;
            });
          }
        }
      } catch (e) {
        console.warn('[LessonsScreen] refetch erro:', e);
      } finally {
        if (!cancelled) {
          // Marca o primeiro carregamento como concluido (refetchs futuros nao piscam loading)
          didInitialMountRef.current = true;
          setLoading(false);
        }
      }
    };

    const onLessonChange = () => { refetchLessons(true); };
    const onExerciseChange = () => { refetchLessons(true); };

    let cleanupLessons: RealtimeCleanupFn = () => {};
    let cleanupExercises: RealtimeCleanupFn = () => {};
    try { cleanupLessons = subscribeStudentLessons(studentId, onLessonChange); } catch (e) {
      console.warn('[LessonsScreen] subscribe student_lessons erro:', e);
    }
    try { cleanupExercises = subscribeStudentExercises(studentId, onExerciseChange); } catch (e) {
      console.warn('[LessonsScreen] subscribe exercises erro:', e);
    }

    const fallback = window.setInterval(refetchLessons, 20000);

    return () => {
      cancelled = true;
      window.clearInterval(fallback);
      cleanupLessons();
      cleanupExercises();
    };
  }, [studentId]);

  useEffect(() => { if (studentId) loadPracticeLogs(true); }, [studentId, loadPracticeLogs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-black">
        <div className="w-12 h-12 border-4 border-[#00C853] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const getLessonThumbnail = (lesson: Lesson): string => {
    if (videoThumbnails[lesson.id]) {
      return videoThumbnails[lesson.id];
    }
    if (lesson.thumbnail_url) {
      return lesson.thumbnail_url;
    }
    return lesson.thumbnail;
  };

  // Retorna TRUE se a aula TEM uma miniatura ESTATICA (thumbnail_url do banco ou fallback generico Unsplash).
  // Nesse caso, NAO exibimos o fallback colorido — a imagem ja eh mostrada na hora, sem esperar geracao.
  const hasStaticThumbnail = (lesson: Lesson): boolean => {
    if (lesson.thumbnail_url) return true;
    if (videoThumbnails[lesson.id]) return true;
    // lesson.thumbnail geralmente eh um placeholder generico (Unsplash) — sempre existe no objeto.
    // Consideramos como "miniatura estatica valida" se for uma URL http(s) valida.
    if (lesson.thumbnail && /^https?:\/\//i.test(lesson.thumbnail)) return true;
    return false;
  };

  const statusStyles: Record<Lesson['status'], { badge: string; border: string; glow: string; overlay: string; text: string }> = {
    unlocked: {
      badge: "bg-[#3b82f6] text-white",
      border: "border-[#3b82f6]/40 ring-1 ring-[#3b82f6]/20",
      glow: "shadow-[0_0_20px_rgba(59,130,246,0.18)]",
      overlay: "from-[#3b82f6]/20",
      text: "🔓 LIBERADA PARA ESTUDO"
    },
    pending_review: {
      badge: "bg-[#eab308] text-black",
      border: "border-[#eab308]/50 ring-1 ring-[#eab308]/30",
      glow: "shadow-[0_0_25px_rgba(234,179,8,0.28)]",
      overlay: "from-[#eab308]/25",
      text: "🕒 AGUARDANDO AVALIAÇÃO"
    },
    approved: {
      badge: "bg-[#22c55e] text-black",
      border: "border-[#22c55e]/50 ring-1 ring-[#22c55e]/30",
      glow: "shadow-[0_0_25px_rgba(34,197,94,0.28)]",
      overlay: "from-[#22c55e]/25",
      text: "✅ AULA APROVADA"
    },
    locked: {
      badge: "bg-zinc-800 text-zinc-500",
      border: "border-white/10",
      glow: "",
      overlay: "from-black/70",
      text: "🔒 BLOQUEADA"
    }
  };

  return (
    <div
      className="flex flex-col h-full bg-black relative w-full min-h-0"
      style={{ touchAction: 'pan-y' as any, WebkitOverflowScrolling: 'touch' as any }}
    >
      {/* Video Modal */}
      {selectedLesson && (
        <div
          className="fixed inset-0 z-[100] bg-black flex flex-col"
          style={{ touchAction: 'manipulation' as any }}
        >
          <div className="flex items-center justify-between px-4 py-3 bg-black/80">
            <h3 className="text-white font-bold truncate">{selectedLesson.title}</h3>
            <button
              onClick={() => { setSelectedLesson(null); setViewingStudentVideo(false); if (videoRef.current) { try { videoRef.current.pause(); } catch (e) {} } }}
              className="p-3 shrink-0"
              style={{ touchAction: 'manipulation' as any, minWidth: 44, minHeight: 44 }}
            >
              <X className="w-7 h-7 text-white" />
            </button>
          </div>
          {selectedLesson.has_exercise && (
            <div className="flex gap-2 px-4 py-2 bg-black/60 border-b border-white/5">
              <button
                onClick={() => { setViewingStudentVideo(false); if (videoRef.current) { try { videoRef.current.pause(); } catch (e) {} } }}
                className={cn(
                  "px-4 py-1.5 rounded-full text-[0.75rem] font-bold transition-all",
                  !viewingStudentVideo ? "bg-[#22c55e] text-black" : "bg-zinc-800 text-zinc-400 hover:text-white"
                )}
              >
                Aula do Professor
              </button>
              <button
                onClick={() => { setViewingStudentVideo(true); if (videoRef.current) { try { videoRef.current.pause(); } catch (e) {} } }}
                className={cn(
                  "px-4 py-1.5 rounded-full text-[0.75rem] font-bold transition-all flex items-center gap-1",
                  viewingStudentVideo ? "bg-[#f97316] text-black" : "bg-zinc-800 text-zinc-400 hover:text-white"
                )}
              >
                <Upload className="w-3 h-3" />
                Meu Envio
              </button>
            </div>
          )}
          <div className="flex-1 flex items-center justify-center bg-black">
            {viewingStudentVideo ? (
              selectedLesson.exercise_video_url ? (
                <video
                  key={`student-${selectedLesson.id}`}
                  src={selectedLesson.exercise_video_url}
                  controls
                  className="w-full h-full max-h-[70vh] object-contain"
                  playsInline
                />
              ) : (
                <div className="text-zinc-400 text-center p-8">
                  Sem video de envio disponivel para esta aula.
                </div>
              )
            ) : (
              selectedLesson.video_url ? (
                <video
                  ref={videoRef}
                  key={`teacher-${selectedLesson.id}`}
                  src={selectedLesson.video_url}
                  controls
                  className="w-full h-full max-h-[70vh] object-contain"
                  playsInline
                />
              ) : (
                <div className="text-zinc-400 text-center p-8">
                  Sem video disponivel para esta aula.
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Modal Diário de Treino */}
      {showPracticeModal && (
        <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !practiceSaving && setShowPracticeModal(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-zinc-900 border border-white/10 rounded-t-3xl sm:rounded-2xl p-5 shadow-2xl animate-in slide-in-from-bottom sm:slide-in-from-bottom-8"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-[#00C853]/15 flex items-center justify-center">
                  <Dumbbell className="w-5 h-5 text-[#00C853]" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg">Registrar Treino</h3>
                  <p className="text-zinc-400 text-xs">Marque aqui o seu treino de hoje</p>
                </div>
              </div>
              <button onClick={() => !practiceSaving && setShowPracticeModal(false)} className="p-2 text-zinc-400 hover:text-white disabled:opacity-40" disabled={practiceSaving}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-zinc-300 text-xs font-bold mb-1.5 block">Duração (minutos)</label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setPracticeMinutes((m) => Math.max(5, (m || 0) - 5))}
                    disabled={practiceSaving}
                    className="w-11 h-11 rounded-xl bg-zinc-800 text-white font-bold text-lg border border-white/10 hover:bg-zinc-700 disabled:opacity-40 active:scale-95"
                  >
                    -5
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={practiceMinutes}
                    onChange={(e) => { const v = parseInt(e.target.value || '0', 10); setPracticeMinutes(isFinite(v) ? Math.max(0, v) : 0); }}
                    disabled={practiceSaving}
                    className="flex-1 h-11 bg-zinc-800 border border-white/10 rounded-xl text-white text-center font-bold text-xl focus:outline-none focus:ring-2 focus:ring-[#00C853]/40 disabled:opacity-60"
                  />
                  <button
                    onClick={() => setPracticeMinutes((m) => (m || 0) + 5)}
                    disabled={practiceSaving}
                    className="w-11 h-11 rounded-xl bg-zinc-800 text-white font-bold text-lg border border-white/10 hover:bg-zinc-700 disabled:opacity-40 active:scale-95"
                  >
                    +5
                  </button>
                </div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {[15, 30, 45, 60, 90].map((m) => (
                    <button
                      key={m}
                      onClick={() => setPracticeMinutes(m)}
                      disabled={practiceSaving}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-bold border transition-all disabled:opacity-40",
                        practiceMinutes === m
                          ? "bg-[#00C853] text-black border-[#00C853]"
                          : "bg-zinc-800 text-zinc-300 border-white/10 hover:text-white"
                      )}
                    >
                      {m} min
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-zinc-300 text-xs font-bold mb-1.5 block">O que você treinou hoje? (opcional)</label>
                <textarea
                  value={practiceNotes}
                  onChange={(e) => setPracticeNotes(e.target.value)}
                  disabled={practiceSaving}
                  rows={3}
                  placeholder="Ex: treinei a pestana F, escala pentatônica de Lá..."
                  className="w-full resize-none rounded-xl bg-zinc-800 border border-white/10 p-3 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#00C853]/40 disabled:opacity-60"
                />
              </div>

              <button
                onClick={handleSavePractice}
                disabled={practiceSaving || !practiceMinutes || practiceMinutes <= 0}
                className="w-full py-3 rounded-xl bg-[#00C853] text-black font-bold text-sm hover:bg-[#00b84a] transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
              >
                {practiceSaving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    Registrando...
                  </>
                ) : (
                  <>
                    <Dumbbell className="w-4 h-4" />
                    Registrar treino de hoje
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scrollable Content - Cards com miniaturas individuais e bordas coloridas por status */}
      <div
        className="flex-1 overflow-y-auto px-4 pt-4 pb-32 w-full min-h-0"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[1.5rem] font-bold text-white">Vídeos</h2>
          <button
            onClick={() => setShowPracticeModal(true)}
            className={cn(
              "flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-bold border transition-all active:scale-95",
              practiceStats.todayDone
                ? "bg-[#00C853]/15 text-[#00C853] border-[#00C853]/30 hover:bg-[#00C853]/25"
                : "bg-[#00C853] text-black border-[#00C853] hover:bg-[#00b84a] shadow-[0_0_20px_rgba(0,200,83,0.25)]"
            )}
          >
            <Dumbbell className="w-4 h-4" />
            {practiceStats.todayDone ? "Registrado ✅" : "Registrar treino"}
          </button>
        </div>

        {/* Card consistência (Diário de Treino) */}
        <div className="mb-5 rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-900/90 via-zinc-900/60 to-black p-4">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="w-4 h-4 text-[#00C853]" />
            <span className="text-white font-bold text-sm">Consistência de treino</span>
            {practiceLogsLoading && (
              <div className="ml-auto w-3.5 h-3.5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-black/40 border border-white/5 p-3 text-center">
              <div className="text-zinc-400 text-[0.65rem] font-bold uppercase tracking-wider mb-1">Últimos 7 dias</div>
              <div className="text-white font-black text-xl tabular-nums">{practiceStats.last7Min}<span className="text-zinc-500 text-xs font-bold ml-0.5">min</span></div>
            </div>
            <div className="rounded-xl bg-black/40 border border-white/5 p-3 text-center">
              <div className="text-zinc-400 text-[0.65rem] font-bold uppercase tracking-wider mb-1">Sequência</div>
              <div className="text-white font-black text-xl tabular-nums flex items-center justify-center gap-1">
                {practiceStats.streak}<span className="text-zinc-500 text-xs font-bold">dias</span>
                {practiceStats.streak >= 3 && <span>🔥</span>}
              </div>
            </div>
            <div className="rounded-xl bg-black/40 border border-white/5 p-3 text-center">
              <div className="text-zinc-400 text-[0.65rem] font-bold uppercase tracking-wider mb-1">Hoje</div>
              <div className={cn("font-black text-xl", practiceStats.todayDone ? "text-[#00C853]" : "text-zinc-500")}>
                {practiceStats.todayDone ? "✅" : "—"}
              </div>
            </div>
          </div>
          {!practiceLogsLoading && recentPracticeLogs.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <div className="text-zinc-400 text-[0.6875rem] font-bold mb-2 uppercase tracking-wide">Últimos treinos</div>
              <div className="space-y-1.5 max-h-28 overflow-y-auto">
                {recentPracticeLogs.slice(0, 5).map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-zinc-300 tabular-nums">{(() => {
                      const d = new Date(l.practice_date + 'T00:00:00');
                      return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
                    })()}</span>
                    <div className="flex-1 truncate text-zinc-500">{l.notes || <span className="italic">Sem observações</span>}</div>
                    <span className="text-white font-bold tabular-nums">{l.duration_minutes} min</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {(lessons || []).length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Lock className="w-10 h-10 text-zinc-700 mb-3" />
            <span className="font-bold text-zinc-500">Nenhuma aula disponível</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(lessons || []).map((lesson, index) => {
            const style = statusStyles[lesson.status];
            const isLocked = lesson.status === 'locked';
            return (
              <div
                key={lesson.id}
                onClick={() => { if (!isLocked) setSelectedLesson(lesson); }}
                className={cn(
                  "relative rounded-2xl overflow-hidden border bg-zinc-900/60 transition-all group",
                  style.border,
                  style.glow,
                  isLocked ? "opacity-40 pointer-events-none grayscale" : "cursor-pointer hover:scale-[1.015] active:scale-[0.99]"
                )}
              >
                {/* Thumbnail */}
                <div className="relative aspect-video w-full bg-black overflow-hidden">
                  {/* Video oculto com preload=metadata - LIMITADO APENAS NA PRIMEIRA AULA para nao travar o compositor do Safari iOS.
                    Para as demais aulas, usamos a duracao "--:--" no primeiro render — apos o usuario abrir o video ela e calculada. */}
                  {lesson.video_url && index === 0 && (
                    <video
                      key={`meta-${lesson.id}`}
                      src={lesson.video_url}
                      preload="metadata"
                      muted
                      playsInline
                      className="hidden"
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget;
                        if (isFinite(v.duration) && v.duration > 0) {
                          setDurationForLesson(lesson.id, v.duration);
                        }
                      }}
                      onError={() => {
                        // So marca como falhou SE NAO TEM thumbnail estatica, senao
                        // a imagem estatica do banco funciona perfeitamente.
                        if (!hasStaticThumbnail(lesson)) {
                          setThumbFailed(prev => ({ ...prev, [lesson.id]: true }));
                        }
                      }}
                    />
                  )}

                  {/* Fallback visual: gradiente colorido + icone.
                      CONDICAO CORRETA para exibir:
                      - A aula NAO tem thumbnail estatica (thumbnail_url / Unsplash fallback) E
                      - Ainda NAO carregou thumbnail DINAMICA (gerada por canvas) OU deu erro real */}
                  <div
                    className={cn(
                      "absolute inset-0 transition-opacity duration-500 flex items-center justify-center pointer-events-none",
                      (!hasStaticThumbnail(lesson) && (!thumbLoaded[lesson.id] || thumbFailed[lesson.id]))
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  >
                    <div className={cn(
                      "absolute inset-0 bg-gradient-to-br",
                      lesson.status === "approved" ? "from-[#166534] via-[#1f2937] to-black"
                      : lesson.status === "pending_review" ? "from-[#a16207] via-[#1f2937] to-black"
                      : lesson.status === "unlocked" ? "from-[#1e40af] via-[#1f2937] to-black"
                      : "from-[#1f2937] via-[#111827] to-black"
                    )} />
                    <div
                      className="absolute inset-0 opacity-20"
                      style={{
                        backgroundImage: "radial-gradient(circle at 30% 40%, rgba(255,255,255,0.08), transparent 45%), radial-gradient(circle at 70% 65%, rgba(255,255,255,0.06), transparent 40%)"
                      }}
                    />
                    {!isLocked && (
                      <div className="relative z-10 w-14 h-14 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 flex items-center justify-center shadow-xl">
                        <Play className="w-6 h-6 text-white fill-white translate-x-[1px]" />
                      </div>
                    )}
                    {isLocked && (
                      <Lock className="relative z-10 w-10 h-10 text-zinc-500" />
                    )}
                  </div>

                  {/* Imagem da miniatura.
                      Regra:
                      - Se tem thumbnail ESTATICA do banco -> sempre mostra, sem esperar nada.
                      - Se GEROU thumbnail dinamica com sucesso -> mostra.
                      - Se falhou tudo e nao tem estatica -> some (deixa aparecer o fallback gradiente). */}
                  {(() => {
                    const hasStatic = hasStaticThumbnail(lesson);
                    const hasDynamic = !!videoThumbnails[lesson.id];
                    const useImg = hasStatic || hasDynamic;
                    const imgFailed = thumbFailed[lesson.id] && !hasStatic;
                    if (!useImg) return null;
                    return (
                      <img
                        src={getLessonThumbnail(lesson)}
                        alt={lesson.title}
                        loading="lazy"
                        onLoad={() => {
                          setThumbLoaded(prev => ({ ...prev, [lesson.id]: true }));
                        }}
                        onError={() => {
                          // Se der erro de carregamento de imagem ESTATICA,
                          // ativa fallback gradiente.
                          setThumbFailed(prev => ({ ...prev, [lesson.id]: true }));
                        }}
                        className={cn(
                          "w-full h-full object-cover transition-all duration-500",
                          imgFailed ? "opacity-0" : "opacity-100",
                          !isLocked && "group-hover:scale-105"
                        )}
                      />
                    );
                  })()}

                  {/* Overlay Gradiente colorido por status */}
                  <div className={cn(
                    "absolute inset-0 bg-gradient-to-t via-black/20 to-transparent opacity-90",
                    style.overlay
                  )} />
                  {/* Duracao - DINAMICA (MM:SS) via onLoadedMetadata, cai p/ "--:--" se ainda nao carregou */}
                  {!isLocked && (
                    <div className="absolute bottom-2 right-2 bg-black/80 px-1.5 py-0.5 rounded text-[0.625rem] text-white font-medium tabular-nums">
                      {videoDurations[lesson.id] || "--:--"}
                    </div>
                  )}
                  {/* Badge de status colorido */}
                  <div className={cn(
                    "absolute top-2 left-2 px-2.5 py-1 rounded-full text-[0.625rem] font-black uppercase tracking-wider shadow-lg",
                    style.badge
                  )}>
                    {style.text}
                  </div>
                  {/* Play button overlay (sempre aparece — menos em bloqueadas) */}
                  {!isLocked && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-14 h-14 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg">
                        <Play className="w-6 h-6 text-white fill-white translate-x-[1px]" />
                      </div>
                    </div>
                  )}
                  {isLocked && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Lock className="w-10 h-10 text-zinc-500 drop-shadow-lg" />
                    </div>
                  )}
                </div>
                {/* Info */}
                <div className="p-3">
                  <h4 className="font-bold text-[0.9375rem] text-white truncate">
                    {lesson.title}
                  </h4>
                  <p className="text-[0.75rem] text-zinc-400 truncate mt-0.5">
                    {lesson.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating Action Buttons (Footer) - Tab navigation */}
      <div className="absolute bottom-0 left-0 right-0 px-4 flex gap-3 bg-gradient-to-t from-black via-black/95 to-transparent pt-12 pb-6 z-20">
        <button
          onClick={() => navigateToTab?.("chat")}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full border border-white/10 text-zinc-300 font-bold text-[0.875rem] bg-zinc-900/60 backdrop-blur-sm hover:bg-zinc-800/80 hover:text-white transition-all active:scale-95"
        >
          <MessageSquare className="w-5 h-5" />
          Chat
        </button>
        <button
          onClick={() => navigateToTab?.("enviar")}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full border border-white/10 text-zinc-300 font-bold text-[0.875rem] bg-zinc-900/60 backdrop-blur-sm hover:bg-zinc-800/80 hover:text-white transition-all active:scale-95"
        >
          <Send className="w-5 h-5" />
          Enviar
        </button>
      </div>
    </div>
  );
}