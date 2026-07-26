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
  Play
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { supabase } from '@/lib/supabase';

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
  const exerciseVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
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
      // Create FormData
      const formData = new FormData();
      formData.append('video', selectedFile);
      formData.append('student_id', studentId);
      formData.append('lesson_id', selectedLessonForUpload.id);

      // Simulate progress
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 10;
        if (progress > 90) {
          clearInterval(interval);
          progress = 90;
        }
        setUploadProgress(Math.floor(progress));
      }, 200);

      // Upload to backend
      const response = await fetch('http://localhost:8000/upload-exercise', {
        method: 'POST',
        body: formData
      });

      clearInterval(interval);

      if (response.ok) {
        setUploadProgress(100);
        // Refresh data
        setTimeout(async () => {
          const { data: exercisesData } = await supabase
            .from('exercises')
            .select('*')
            .eq('student_id', studentId)
            .order('created_at', { ascending: false });
          if (exercisesData && exercisesData.length > 0) {
            setLastVideo({ thumbnail: exercisesData[0].thumbnail_url || "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400" });
          }
          // Refresh student profile and instrument IDs
          const { data: refreshProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', studentId)
            .single();
          
          let refreshInstruments: string[] = [];
          if (refreshProfile?.instrument) {
            refreshInstruments = String(refreshProfile.instrument || '')
              .split(',')
              .map(i => i.trim().toLowerCase())
              .filter(i => i.length > 0);
          }
          // FALLBACK: if empty, default to ['Guitarra']
          if (refreshInstruments.length === 0) {
            refreshInstruments = ['guitarra'];
            console.log('[DEBUG] Fallback refresh: instrumentos vazios, usando Guitarra (EnvioScreen)');
          }
          
          console.log('[DEBUG] Instrumentos após refresh (EnvioScreen):', refreshInstruments);
          
          const { data: refreshInstrumentsData } = await supabase
            .from('instruments')
            .select('id, name');
          const refreshInstrumentIds = (refreshInstrumentsData || [])
            .filter(inst => refreshInstruments.includes(String(inst.name || '').toLowerCase()))
            .map(inst => inst.id);
          
          console.log('[DEBUG] IDs de instrumentos após refresh (EnvioScreen):', refreshInstrumentIds);
          
          // Refresh modules FILTERED BY INSTRUMENT - NO FALLBACK
          let modulesData: any = [];
          if (refreshInstrumentIds.length > 0) {
            const query = supabase
              .from('modules')
              .select('*, lessons(*)')
              .order('order', { ascending: true })
              .in('instrument_id', refreshInstrumentIds);
            const result = await query;
            modulesData = result.data || [];
          }
          // Double client-side filter for safety
          modulesData = (modulesData || []).filter((mod: any) => 
            refreshInstrumentIds.includes(mod.instrument_id)
          );
          
          const { data: accessData } = await supabase
            .from('student_lessons')
            .select('*')
            .eq('student_id', studentId);
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
                return { id: lesson.id, title: lesson.title, status, type: 'video', exercise_video_url: exercise?.video_url || null, exercise_thumbnail_url: exercise?.thumbnail_url || null };
              });
              const allCompleted = moduleLessons.every((l: any) => l.status === 'completed');
              const allLocked = moduleLessons.every((l: any) => l.status === 'locked');
              let modStatus: Module['status'] = 'pending';
              if (allCompleted) modStatus = 'completed';
              else if (allLocked) modStatus = 'locked';
              return { id: mod.id, title: mod.title, status: modStatus, lessons: moduleLessons };
            });
            setModules(assembledModules);
            const totalLessons = assembledModules.reduce((acc, m) => acc + m.lessons.length, 0);
            const completedLessons = assembledModules.reduce((acc, m) => 
              acc + m.lessons.filter(l => l.status === 'completed').length, 0
            );
            setProgress(totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0);
          }
          setUploadModalOpen(false);
          setSelectedFile(null);
          setSelectedLessonForUpload(null);
        }, 500);
      } else {
        throw new Error('Upload failed');
      }
    } catch (error) {
      console.error('Error uploading:', error);
      alert('Falha ao enviar vídeo');
    } finally {
      setUploading(false);
      setUploadProgress(0);
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

      {/* Header da Aba */}
      <div className="px-4 py-6 flex items-center gap-4 border-b border-white/5">
        <div className="w-20 h-14 rounded-xl overflow-hidden relative flex-shrink-0 bg-zinc-800">
          {lastVideo ? (
            <>
              <img src={lastVideo.thumbnail} alt="Last Video" className="w-full h-full object-cover opacity-60" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Video className="w-6 h-6 text-zinc-500" />
              </div>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Video className="w-6 h-6 text-zinc-500" />
            </div>
          )}
        </div>
        <div className="flex flex-col">
          <h2 className="text-[1.125rem] font-bold text-white leading-tight">Meu Repositório de Exercícios</h2>
          <div className="flex gap-2 mt-1">
            <Video className="w-4 h-4 text-zinc-500" />
            <Mic className="w-4 h-4 text-zinc-500" />
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
