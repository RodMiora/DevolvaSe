import React, { useState, useEffect, useRef } from "react";
import { Play, CheckCircle2, Lock, MessageSquare, Send, X, Upload, Clock, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

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
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoThumbnails, setVideoThumbnails] = useState<Record<string, string>>({});
  const thumbVideoRefs = useRef<Record<string, HTMLVideoElement>>({});
  const [viewingStudentVideo, setViewingStudentVideo] = useState(false);

  const generateThumbnail = (lessonId: string, videoUrl: string) => {
    // Avoid re-generating if already in state
    if (videoThumbnails[lessonId]) return;

    // Create a hidden video element to capture a frame
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    
    video.addEventListener('loadeddata', () => {
      try {
        // Seek to 0.5s to get a frame
        video.currentTime = Math.min(0.5, video.duration || 0.5);
      } catch (e) {
        // ignore seek errors
      }
    });

    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx && canvas.width > 0 && canvas.height > 0) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          setVideoThumbnails(prev => ({
            ...prev,
            [lessonId]: dataUrl
          }));
        }
      } catch (e) {
        // If canvas capture fails, just skip generating thumbnail
        console.warn('Erro ao gerar miniatura:', e);
      } finally {
        // Clean up
        try { video.pause(); } catch (e) {}
        try { video.src = ''; } catch (e) {}
      }
    });

    video.addEventListener('error', () => {
      // If video fails, just skip generating thumbnail
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

  const featuredLesson = lessons.find(l => l.status === 'pending_review') || lessons.find(l => l.status === 'unlocked') || lessons.find(l => l.status === 'approved') || null;

  const getLessonThumbnail = (lesson: Lesson): string => {
    if (videoThumbnails[lesson.id]) {
      return videoThumbnails[lesson.id];
    }
    if (lesson.thumbnail_url) {
      return lesson.thumbnail_url;
    }
    return lesson.thumbnail;
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

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-32 w-full">
        <h2 className="text-[1.5rem] font-bold text-white mb-6">Vídeos</h2>

        {/* Featured Video Player (Top) */}
        {featuredLesson && (
          <div
            onClick={() => {
              if (featuredLesson.status !== 'locked') setSelectedLesson(featuredLesson);
            }}
            className={cn(
              "relative aspect-video rounded-2xl overflow-hidden mb-8 group cursor-pointer",
              featuredLesson.status === 'pending_review' && "shadow-[0_0_20px_rgba(234,179,8,0.25)]",
              featuredLesson.status === 'approved' && "shadow-[0_0_20px_rgba(34,197,94,0.25)]",
              featuredLesson.status === 'unlocked' && "shadow-[0_0_20px_rgba(59,130,246,0.25)]"
            )}
          >
            <img
              src={getLessonThumbnail(featuredLesson)}
              alt={featuredLesson.title}
              className="w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-500"
            />
            {featuredLesson.status !== 'locked' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20 group-hover:scale-110 transition-transform">
                  <Play className="w-8 h-8 text-white fill-white" />
                </div>
              </div>
            )}
            {featuredLesson.status !== 'locked' && (
              <div className={cn(
                "absolute top-3 left-3 px-3 py-1.5 rounded-full text-[0.625rem] font-black uppercase tracking-wider shadow-lg",
                featuredLesson.status === 'approved' && "bg-[#22c55e] text-black",
                featuredLesson.status === 'pending_review' && "bg-[#eab308] text-black",
                featuredLesson.status === 'unlocked' && "bg-[#3b82f6] text-white"
              )}>
                {featuredLesson.status === 'approved' && "AULA APROVADA ✅"}
                {featuredLesson.status === 'pending_review' && "AGUARDANDO AVALIAÇÃO 🕒"}
                {featuredLesson.status === 'unlocked' && "LIBERADA PARA ESTUDO"}
              </div>
            )}
            {/* VU Glow Border */}
            <div className={cn(
              "absolute inset-0 rounded-2xl border-2 border-transparent opacity-30",
              "bg-gradient-to-r from-[#22c55e] via-[#eab308] to-[#ef4444] [mask-image:linear-gradient(white,white)_padding-box,linear-gradient(white,white)]"
            )} />
          </div>
        )}

        {/* Lessons Timeline */}
        <div className="space-y-4">
          {(lessons || []).map((lesson) => (
            <div
              key={lesson.id}
              onClick={() => {
                if (lesson.status !== 'locked') setSelectedLesson(lesson);
              }}
              className={cn(
                "relative flex items-center gap-3 p-3 rounded-xl border transition-all w-full cursor-pointer",
                lesson.status === "approved" && "bg-[#22c55e]/5 border-[#22c55e]/30",
                lesson.status === "pending_review" && "bg-[#eab308]/5 border-[#eab308]/40 shadow-[0_0_15px_rgba(234,179,8,0.12)] scale-[1.01] z-10",
                lesson.status === "unlocked" && "bg-[#3b82f6]/5 border-[#3b82f6]/30",
                lesson.status === "locked" && "bg-black border-white/5 opacity-40 pointer-events-none"
              )}
            >
              {/* Thumbnail */}
              <div className="relative w-24 h-16 rounded-lg overflow-hidden flex-shrink-0">
                <img src={getLessonThumbnail(lesson)} alt={lesson.title} className="w-full h-full object-cover" />
                <div className="absolute bottom-1 right-1 bg-black/80 px-1 rounded text-[0.625rem] text-white">
                  {lesson.duration}
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h4 className={cn(
                  "font-bold text-[0.875rem] truncate",
                  lesson.status === "locked" ? "text-zinc-500" : "text-white"
                )}>
                  {lesson.title}
                </h4>
                <p className="text-[0.75rem] text-zinc-400 truncate">{lesson.description}</p>
                {lesson.status === "unlocked" && (
                  <span className="text-[0.625rem] font-black text-[#3b82f6] uppercase mt-1 block tracking-wider">
                    🔓 LIBERADA PARA ESTUDO
                  </span>
                )}
                {lesson.status === "pending_review" && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[0.625rem] font-black text-[#eab308] uppercase tracking-wider">
                      🕒 AGUARDANDO AVALIAÇÃO
                    </span>
                  </div>
                )}
                {lesson.status === "approved" && (
                  <span className="text-[0.625rem] font-black text-[#22c55e] uppercase mt-1 block tracking-wider">
                    ✅ AULA APROVADA
                  </span>
                )}
              </div>

              {/* Status Icon */}
              <div className="flex-shrink-0">
                {lesson.status === "approved" && (
                  <CheckCircle2 className="w-6 h-6 text-[#22c55e] fill-[#22c55e]/10" />
                )}
                {lesson.status === "pending_review" && (
                  <div className="w-6 h-6 rounded-full border-2 border-[#eab308] flex items-center justify-center bg-[#eab308]/10">
                    <Clock className="w-3.5 h-3.5 text-[#eab308]" />
                  </div>
                )}
                {lesson.status === "unlocked" && (
                  <div className="w-6 h-6 rounded-full border-2 border-[#3b82f6] flex items-center justify-center bg-[#3b82f6]/10">
                    <Unlock className="w-3.5 h-3.5 text-[#3b82f6]" />
                  </div>
                )}
                {lesson.status === "locked" && (
                  <Lock className="w-5 h-5 text-zinc-600" />
                )}
              </div>
            </div>
          ))}

          {/* Locked Module Example */}
          {lessons.length === 0 && (
            <div className="mt-6 flex items-center justify-center gap-3 p-4 rounded-xl bg-zinc-900/30 border border-white/5">
              <Lock className="w-5 h-5 text-zinc-500" />
              <span className="font-bold text-zinc-500">Nenhuma aula disponível</span>
            </div>
          )}
        </div>
      </div>

      {/* Floating Action Buttons (Footer) */}
      <div className="absolute bottom-0 left-0 right-0 px-4 flex gap-3 bg-gradient-to-t from-black via-black/95 to-transparent pt-12 pb-6 z-20">
        <button className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full border border-[#22c55e] text-[#22c55e] font-bold text-[0.875rem] bg-black/50 backdrop-blur-sm transition-transform active:scale-95">
          <MessageSquare className="w-5 h-5" />
          Chat
        </button>
        <button className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white font-bold text-[0.875rem] shadow-[0_4px_15px_rgba(239,68,68,0.3)] transition-transform active:scale-95">
          <Send className="w-5 h-5" />
          Enviar
        </button>
      </div>
    </div>
  );
}