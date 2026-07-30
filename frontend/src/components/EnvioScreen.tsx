import React, { useState, useEffect, useRef } from 'react';
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

interface LessonSubmission {
  id: string;
  title: string;
  status: 'completed' | 'awaiting-feedback' | 'not-submitted' | 'locked';
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
              const access = accessData?.find((a: any) => a.lesson_id === lesson.id);
              const exercise = exercisesData?.find((e: any) => e.lesson_id === lesson.id);

              let status: LessonSubmission['status'] = 'locked';
              if (access) {
                if (access.is_completed) status = 'completed';
                else if (exercise) status = 'awaiting-feedback';
                else if (!access.is_locked) status = 'not-submitted';
              }

              return {
                id: lesson.id,
                title: lesson.title,
                status,
                type: 'video', // Defaulting to video for now
                exercise_video_url: exercise?.video_url || null,
                exercise_thumbnail_url: exercise?.thumbnail_url || null
              };
            });

            // Determine module status
            const allCompleted = moduleLessons.every((l: any) => l.status === 'completed');
            const allLocked = moduleLessons.every((l: any) => l.status === 'locked');
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

          setModules(assembledModules);
          
          // Set open module to the first pending one
          const firstPending = assembledModules.find(m => m.status === 'pending');
          if (firstPending) setOpenModules([firstPending.id]);

          // Calculate progress
          const totalLessons = assembledModules.reduce((acc, m) => acc + m.lessons.length, 0);
          const completedLessons = assembledModules.reduce((acc, m) => 
            acc + m.lessons.filter(l => l.status === 'completed').length, 0
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
    fetchData();
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !selectedLessonForUpload || !studentId) return;

    setUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('video', selectedFile);
      formData.append('student_id', studentId);
      formData.append('lesson_id', selectedLessonForUpload.id);

      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 10;
        if (progress > 90) {
          clearInterval(interval);
          progress = 90;
        }
        setUploadProgress(Math.floor(progress));
      }, 200);

      const response = await apiFetch('/upload-exercise', {
        method: 'POST',
        body: formData
      }, { prefix: 'Falha ao enviar vídeo', jsonBody: false, bearer: true, throwOnError: false });

      clearInterval(interval);

      if (response.ok) {
        setUploadProgress(100);
        setTimeout(async () => {
          await fetchData();
          setUploadModalOpen(false);
          setSelectedFile(null);
          setSelectedLessonForUpload(null);
        }, 500);
      } else {
        const t = await response.text().catch(() => '');
        let detail = '';
        try {
          const j = JSON.parse(t || '{}');
          detail = j?.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : '';
        } catch {}
        const msg = `Falha ao enviar vídeo — HTTP ${response.status}${response.statusText ? ` (${response.statusText})` : ''}${detail ? ' | ' + detail : ''}`;
        console.error('Upload exercise failed:', msg);
        alert(msg);
      }
    } catch (error) {
      console.error('Error uploading:', error);
      apiAlert('Falha ao enviar vídeo', error);
    } finally {
      setUploading(false);
      if (!uploadModalOpen) setUploadProgress(0);
    }
  };

  const handleDeleteExercise = async (lessonId: string) => {
    if (!window.confirm('Deseja excluir este treino enviado?')) return;
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
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-4 p-8 border-2 border-dashed border-zinc-700 rounded-xl cursor-pointer mb-4 hover:border-zinc-600 transition-colors">
                <Upload className="w-10 h-10 text-zinc-500" />
                <p className="text-zinc-500">Selecione um vídeo</p>
                <input type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
              </label>
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
                      ) : (lesson.status === 'awaiting-feedback' || lesson.status === 'completed') && (lesson.exercise_video_url || lesson.exercise_thumbnail_url) ? (
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
                          {lesson.status === 'completed' && (
                            <div className="flex items-center gap-1">
                              <span className="text-[0.6875rem] text-[#22c55e] font-bold uppercase">Concluido</span>
                              <CheckCircle2 className="w-3 h-3 text-[#22c55e] fill-[#22c55e]/10" />
                            </div>
                          )}
                          {lesson.status === 'awaiting-feedback' && (
                            <div className="flex items-center gap-1">
                              <span className="text-[0.6875rem] text-[#f97316] font-bold uppercase">Video Enviado</span>
                              <CheckCircle2 className="w-3 h-3 text-[#f97316] fill-[#f97316]/10" />
                            </div>
                          )}
                          {lesson.status === 'not-submitted' && (
                            <span className="text-[0.6875rem] text-zinc-500 font-bold uppercase">Aguardando Video</span>
                          )}
                          {lesson.status === 'locked' && (
                            <span className="text-[0.6875rem] text-zinc-600 font-bold uppercase">Bloqueado</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      {lesson.status === 'completed' && (lesson.exercise_video_url ? (
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
                      {lesson.status === 'awaiting-feedback' && (
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
                      {lesson.status === 'not-submitted' && (
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
