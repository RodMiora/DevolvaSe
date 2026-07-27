import React, { useState, useEffect, useRef } from "react";
import { Play, CheckCircle2, Lock, MessageSquare, Send, X, Upload, Clock, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useTabNavigation } from "./TabNavigationContext";

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

  useEffect(() => {
    const fetchLessons = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

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
          console.log('[DEBUG] Fallback aplicado: instrumentos vazios, usando Guitarra (Lessons)');
        }
        
        console.log('[DEBUG] Instrumentos do perfil do aluno (Lessons):', studentInstruments);
        
        // 0.5. Fetch all INSTRUMENTS (this is the correct table name - TeacherDashboard line 302 uses 'instruments')
        const { data: instrumentsData } = await supabase
          .from('instruments')
          .select('id, name');
        
        console.log('[DEBUG] Instrumentos disponíveis no banco (Lessons):', instrumentsData);
        
        // Find instrument IDs that match student instruments (by name)
        const studentInstrumentIds = (instrumentsData || [])
          .filter(inst => studentInstruments.includes(String(inst.name || '').toLowerCase()))
          .map(inst => inst.id);
        
        console.log('[DEBUG] IDs de instrumentos correspondentes ao aluno (Lessons):', studentInstrumentIds);

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
        
        console.log('[DEBUG] Módulos retornados do banco (Lessons):', modulesData);
        
        // Double client-side filter for safety
        modulesData = (modulesData || []).filter((mod: any) => 
          studentInstrumentIds.includes(mod.instrument_id)
        );

        // Fetch student lesson access
        const { data: accessData } = await supabase
          .from('student_lessons')
          .select('*')
          .eq('student_id', user.id);

        // Fetch student exercises
        const { data: exercisesData } = await supabase
          .from('exercises')
          .select('*')
          .eq('student_id', user.id);

        if (modulesData) {
          const allLessons: Lesson[] = [];
          modulesData.forEach((mod: any) => {
            (mod.lessons || []).forEach((lesson: any) => {
              const access = (accessData || []).find((a: any) => a.lesson_id === lesson.id);
              const exercise = (exercisesData || []).find((e: any) => e.lesson_id === lesson.id);

              // Priority 1: explicit access.status from DB
              // Priority 2: derive from is_locked / is_completed / exercise presence (backward compat)
              let status: Lesson['status'] = 'locked';
              if (access?.status && ['locked','unlocked','pending_review','approved'].includes(String(access.status))) {
                status = access.status as Lesson['status'];
              } else {
                if (access?.is_completed) status = 'approved';
                else if (exercise) status = 'pending_review';
                else if (access && !access.is_locked) status = 'unlocked';
                else status = 'locked';
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
                exercise_video_url: exercise?.video_url || null,
                exercise_thumbnail_url: exercise?.thumbnail_url || null,
                has_exercise: !!exercise
              });
            });
          });
          setLessons(allLessons);

          // After setting lessons, generate thumbnails for lessons that have video but no thumbnail_url
          allLessons.forEach(lesson => {
            if (!lesson.thumbnail_url && lesson.video_url) {
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
    <div className="flex flex-col h-full bg-black relative w-full overflow-hidden">
      {/* Video Modal */}
      {selectedLesson && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-black/80">
            <h3 className="text-white font-bold truncate">{selectedLesson.title}</h3>
            <button onClick={() => { setSelectedLesson(null); setViewingStudentVideo(false); if (videoRef.current) { try { videoRef.current.pause(); } catch (e) {} } }} className="p-2">
              <X className="w-6 h-6 text-white" />
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

      {/* Scrollable Content - Cards com miniaturas individuais e bordas coloridas por status */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-32 w-full">
        <h2 className="text-[1.5rem] font-bold text-white mb-6">Vídeos</h2>

        {(lessons || []).length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Lock className="w-10 h-10 text-zinc-700 mb-3" />
            <span className="font-bold text-zinc-500">Nenhuma aula disponível</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(lessons || []).map((lesson) => {
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
                  {/* Video oculto com preload=metadata (segunda garantia p/ duracao real se canvas falhar) */}
                  {lesson.video_url && (
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