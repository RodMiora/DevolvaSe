import React, { useState, useEffect } from 'react';
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
  Play,
  Circle
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { supabase } from '@/lib/supabase';

interface LessonSubmission {
  id: string;
  title: string;
  status: 'completed' | 'awaiting-feedback' | 'not-submitted' | 'locked';
  type: 'video' | 'audio';
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

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // 1. Fetch Modules and Lessons
        const { data: modulesData } = await supabase
          .from('modules')
          .select('*, lessons(*)')
          .order('order', { ascending: true });

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
                type: 'video' // Defaulting to video for now
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

  return (
    <div className="flex flex-col h-full bg-black w-full overflow-hidden relative">
      {/* Header da Aba */}
      <div className="px-4 py-6 flex items-center gap-4 border-b border-white/5">
        <div className="w-20 h-14 rounded-xl overflow-hidden relative flex-shrink-0 bg-zinc-800">
          {lastVideo ? (
            <>
              <img src={lastVideo.thumbnail} alt="Last Video" className="w-full h-full object-cover opacity-60" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Play className="w-4 h-4 text-white fill-white" />
              </div>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Video className="w-6 h-6 text-zinc-600" />
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
                            <span className="text-[0.6875rem] text-[#22c55e] font-bold uppercase">Concluído</span>
                          )}
                          {lesson.status === 'awaiting-feedback' && (
                            <span className="text-[0.6875rem] text-[#f97316] font-bold uppercase">Aguardando Feedback</span>
                          )}
                          {lesson.status === 'not-submitted' && (
                            <span className="text-[0.6875rem] text-zinc-500 font-bold uppercase">Aguardando Vídeo</span>
                          )}
                          {lesson.status === 'locked' && (
                            <span className="text-[0.6875rem] text-zinc-600 font-bold uppercase">Bloqueado</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      {lesson.status === 'completed' && <CheckCircle2 className="w-5 h-5 text-[#22c55e]" />}
                      {lesson.status === 'awaiting-feedback' && <div className="w-5 h-5 rounded-full border-2 border-[#f97316] flex items-center justify-center"><div className="w-2 h-2 bg-[#f97316] rounded-full" /></div>}
                      {lesson.status === 'not-submitted' && (
                        <div className="flex items-center gap-2">
                          <Circle className="w-5 h-5 text-zinc-700" />
                          <button className="px-3 py-1.5 rounded-full border border-[#f97316] text-[#f97316] text-[0.6875rem] font-bold active:scale-95 transition-transform">
                            Enviar Vídeo
                          </button>
                        </div>
                      )}
                      {lesson.status === 'locked' && (
                        <button disabled className="px-3 py-1.5 rounded-full border border-zinc-800 text-zinc-800 text-[0.6875rem] font-bold opacity-50">
                          Enviar Vídeo
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
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-zinc-900/90 backdrop-blur-md border-t border-white/5 flex items-center justify-between px-6 z-50">
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
