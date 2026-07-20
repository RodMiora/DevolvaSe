"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { 
  Users, 
  BookOpen, 
  Settings, 
  LayoutGrid, 
  Search, 
  Filter, 
  Plus, 
  LogOut, 
  MoreVertical,
  MessageCircle,
  Video,
  Mic,
  Smile,
  Paperclip,
  Send,
  Play,
  CheckCircle2,
  Lock,
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
  Eye,
  EyeOff
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Student {
  id: string;
  full_name: string;
  avatar_url?: string;
  instrument: string;
  unread_count: number;
  progress: number; // 0 to 100
}

interface Message {
  id: string;
  sender_id: string;
  content: string;
  type: 'text' | 'audio' | 'video' | 'image' | 'emoji';
  created_at: string;
  file_name?: string;
  thumbnail_url?: string;
  exercise_id?: string;
}

interface Module {
  id: string;
  title: string;
  lessons: Lesson[];
}

interface Lesson {
  id: string;
  title: string;
  is_locked: boolean;
  video_url?: string;
}

interface Course {
  id: string;
  title: string;
  instrument: string;
  modules_count: number;
}

interface CourseVideo {
  id: string;
  title: string;
  thumbnail: string;
  module: string;
  views: number;
  exercises_count: number;
}

export default function TeacherDashboard() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'cursos' | 'alunos' | 'config'>('dashboard');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [viewMode, setViewMode] = useState<'chat' | 'lessons'>('chat');
  const [students, setStudents] = useState<Student[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseVideos, setCourseVideos] = useState<CourseVideo[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [openModules, setOpenModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  
  // Add Student Form State
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [instrument, setInstrument] = useState("Guitarra");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    fetchStudents();
    fetchCourses();
  }, []);

  const fetchCourses = async () => {
    // In a real scenario, this would fetch from 'instruments' or a 'courses' table
    const mockCourses: Course[] = [
      { id: '1', title: 'Guitarra Iniciante', instrument: 'Guitarra', modules_count: 5 },
      { id: '2', title: 'Violão Popular', instrument: 'Violão', modules_count: 3 },
      { id: '3', title: 'Bateria do Zero', instrument: 'Bateria', modules_count: 4 },
    ];
    setCourses(mockCourses);
  };

  const fetchCourseVideos = async (courseId: string) => {
    // Mocking videos for now
    const mockVideos: CourseVideo[] = [
      { id: 'v1', title: 'Lesson 1: Postura', module: 'Módulo 1', thumbnail: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400', views: 124, exercises_count: 48 },
      { id: 'v2', title: 'Lesson 2: Acordes', module: 'Módulo 1', thumbnail: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400', views: 98, exercises_count: 32 },
    ];
    setCourseVideos(mockVideos);
  };

  useEffect(() => {
    if (selectedCourse) {
      fetchCourseVideos(selectedCourse.id);
    }
  }, [selectedCourse]);

  useEffect(() => {
    if (selectedStudent) {
      fetchMessages(selectedStudent.id);
      fetchStudentLessons(selectedStudent.id);
      
      // Subscribe to real-time messages
      const channel = supabase
        .channel(`chat:${selectedStudent.id}`)
        .on('postgres_changes', { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'chat_messages' 
        }, payload => {
          setMessages(prev => [...prev, payload.new as Message]);
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [selectedStudent]);

  const fetchStudents = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'student');
    
    if (data) {
      // Mocking unread and progress for now, will integrate later
      const studentsWithData = data.map(s => ({
        ...s,
        instrument: s.instrument || 'Guitarra',
        unread_count: Math.floor(Math.random() * 5),
        progress: Math.floor(Math.random() * 100)
      }));
      setStudents(studentsWithData);
    }
  };

  const fetchMessages = async (studentId: string) => {
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .or(`sender_id.eq.${studentId},receiver_id.eq.${studentId}`)
      .order('created_at', { ascending: true });
    
    if (data) setMessages(data);
  };

  const fetchStudentLessons = async (studentId: string) => {
    const { data: modulesData } = await supabase
      .from('modules')
      .select('*, lessons(*)');
    
    const { data: accessData } = await supabase
      .from('student_lessons')
      .select('*')
      .eq('student_id', studentId);

    if (modulesData) {
      const formattedModules = modulesData.map(mod => ({
        id: mod.id,
        title: mod.title,
        lessons: mod.lessons.map((lesson: any) => {
          const access = accessData?.find(a => a.lesson_id === lesson.id);
          return {
            id: lesson.id,
            title: lesson.title,
            is_locked: access ? access.is_locked : true,
            video_url: lesson.video_url
          };
        })
      }));
      setModules(formattedModules);
      if (formattedModules.length > 0) setOpenModules([formattedModules[0].id]);
    }
  };

  const toggleLessonLock = async (lessonId: string, currentLocked: boolean) => {
    if (!selectedStudent) return;

    const { error } = await supabase
      .from('student_lessons')
      .update({ is_locked: !currentLocked })
      .eq('student_id', selectedStudent.id)
      .eq('lesson_id', lessonId);

    if (!error) {
      setModules(prev => prev.map(mod => ({
        ...mod,
        lessons: mod.lessons.map(l => l.id === lessonId ? { ...l, is_locked: !currentLocked } : l)
      })));
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/admin/create-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          username: username.trim().toLowerCase(),
          password: password,
          instrument: instrument
        })
      });

      if (response.ok) {
        setShowAddModal(false);
        setFullName("");
        setUsername("");
        setPassword("");
        fetchStudents();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-white overflow-hidden font-sans">
      {/* COLUNA 1 - Menu Lateral */}
      <aside className="w-64 border-r border-white/5 flex flex-col bg-[#0d0d0d]">
        <div className="p-6 flex items-center gap-3">
          <div className="flex items-end gap-[2px] h-6">
            {[0.4, 0.7, 1, 0.6, 0.8].map((h, i) => (
              <div key={i} className="w-1 bg-gradient-to-t from-[#22c55e] via-[#f97316] to-[#ef4444] rounded-full" style={{ height: `${h * 100}%` }} />
            ))}
          </div>
          <span className="text-xl font-bold tracking-tight">DevolvaSe</span>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
            { id: 'cursos', label: 'Meus Cursos', icon: BookOpen },
            { id: 'alunos', label: 'Alunos', icon: Users },
            { id: 'config', label: 'Configurações', icon: Settings },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
                activeTab === item.id 
                  ? "bg-gradient-to-r from-[#22c55e]/10 to-[#f97316]/10 text-white border border-white/5 shadow-[0_0_15px_rgba(34,197,94,0.05)]" 
                  : "text-zinc-500 hover:text-white hover:bg-white/5"
              )}
            >
              <item.icon className={cn("w-5 h-5", activeTab === item.id ? "text-[#22c55e]" : "group-hover:text-white")} />
              <span className="font-bold text-[0.9375rem]">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/5 space-y-4">
          <div className="flex items-center gap-3 px-2">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#22c55e] to-[#f97316] p-[2px]">
              <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center overflow-hidden">
                <img src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100" alt="Avatar" className="w-full h-full object-cover" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">Prof. Rodrigo</p>
              <p className="text-[0.625rem] text-zinc-500 uppercase tracking-widest font-bold">Guitarra</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-zinc-900/50 text-zinc-400 hover:text-white border border-white/5 transition-colors font-bold text-sm"
          >
            <LogOut className="w-4 h-4" />
            Sair da conta
          </button>
        </div>
      </aside>

      {/* COLUNA 2 - Seletor Central */}
      <section className="w-80 border-r border-white/5 flex flex-col bg-[#0d0d0d]/50">
        <div className="p-6 space-y-4">
          {activeTab === 'cursos' ? (
            <div className="flex flex-col gap-1">
              <h3 className="text-xl font-bold">Meus Cursos</h3>
              <p className="text-zinc-500 text-xs">Gerencie seu conteúdo por instrumento.</p>
            </div>
          ) : (
            <button 
              onClick={() => setShowAddModal(true)}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-white font-bold text-sm shadow-lg shadow-green-500/10 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Adicionar Novo Aluno
            </button>
          )}

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input 
              type="text"
              placeholder={activeTab === 'cursos' ? "Buscar curso..." : "Buscar aluno..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900/50 border border-white/5 rounded-xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 space-y-2 pb-6">
          {activeTab === 'cursos' ? (
            courses.filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase())).map((course) => (
              <button
                key={course.id}
                onClick={() => setSelectedCourse(course)}
                className={cn(
                  "w-full p-4 rounded-2xl border transition-all duration-200 flex items-center gap-4 group text-left",
                  selectedCourse?.id === course.id 
                    ? "bg-zinc-900 border-[#22c55e]/30 shadow-[0_0_20px_rgba(34,197,94,0.05)]" 
                    : "bg-transparent border-transparent hover:bg-white/5"
                )}
              >
                <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-zinc-500" />
                </div>
                <div>
                  <h4 className="font-bold text-sm truncate">{course.title}</h4>
                  <p className="text-[0.6875rem] text-zinc-500 font-medium">{course.modules_count} Módulos • {course.instrument}</p>
                </div>
              </button>
            ))
          ) : (
            students.filter(s => s.full_name.toLowerCase().includes(searchQuery.toLowerCase())).map((student) => (
              <button
                key={student.id}
                onClick={() => setSelectedStudent(student)}
                className={cn(
                  "w-full p-4 rounded-2xl border transition-all duration-200 flex items-center gap-4 group",
                  selectedStudent?.id === student.id 
                    ? "bg-zinc-900 border-[#22c55e]/30 shadow-[0_0_20px_rgba(34,197,94,0.05)]" 
                    : "bg-transparent border-transparent hover:bg-white/5"
                )}
              >
                <div className="relative">
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-zinc-800">
                    <img src={student.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${student.full_name}`} alt={student.full_name} className="w-full h-full object-cover" />
                  </div>
                  {student.unread_count > 0 && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-[#ef4444] rounded-full border-2 border-[#0d0d0d] flex items-center justify-center text-[0.625rem] font-bold">
                      {student.unread_count}
                    </div>
                  )}
                </div>
                
                <div className="flex-1 text-left min-w-0">
                  <h4 className="font-bold text-sm truncate">{student.full_name}</h4>
                  <p className="text-[0.6875rem] text-zinc-500 font-medium">{student.instrument}</p>
                  
                  {/* Mini VU Meter */}
                  <div className="flex gap-[1px] items-end h-2 mt-2">
                    {[...Array(12)].map((_, i) => {
                      const active = (i / 11) * 100 <= student.progress;
                      return (
                        <div 
                          key={i} 
                          className={cn(
                            "flex-1 rounded-full",
                            active 
                              ? i < 4 ? "bg-[#22c55e]" : i < 8 ? "bg-[#f97316]" : "bg-[#ef4444]"
                              : "bg-zinc-800"
                          )}
                          style={{ height: `${20 + (i * 7)}%` }}
                        />
                      );
                    })}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {/* COLUNA 3 - Área de Ação */}
      <main className="flex-1 flex flex-col bg-black relative">
        {activeTab === 'cursos' ? (
          selectedCourse ? (
            <>
              <header className="h-20 border-b border-white/5 flex items-center justify-between px-8 bg-[#0d0d0d]/30 backdrop-blur-md">
                <div className="flex items-center gap-6">
                  <h2 className="text-xl font-bold">Gerenciar Curso: <span className="text-zinc-500">{selectedCourse.title}</span></h2>
                </div>
                <button className="px-6 py-3 rounded-xl bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-white font-bold text-sm shadow-lg shadow-green-500/10 active:scale-[0.98] transition-all flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Upload de Novo Vídeo
                </button>
              </header>
              
              <div className="flex-1 overflow-y-auto p-8 grid grid-cols-2 lg:grid-cols-3 gap-6">
                {courseVideos.map((video) => (
                  <div key={video.id} className="bg-zinc-900/40 rounded-3xl border border-white/5 overflow-hidden group hover:border-[#22c55e]/30 transition-all">
                    <div className="relative aspect-video bg-black/40">
                      <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover opacity-60" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center">
                          <Play className="w-6 h-6 text-white fill-white" />
                        </button>
                      </div>
                      <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-black/60 backdrop-blur-md text-[0.625rem] font-bold text-zinc-400 uppercase tracking-wider">
                        {video.module}
                      </div>
                    </div>
                    <div className="p-5 space-y-4">
                      <div className="flex justify-between items-start gap-2">
                        <h4 className="font-bold text-sm leading-tight">{video.title}</h4>
                        <button className="text-zinc-600 hover:text-white transition-colors">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                          <Eye className="w-3.5 h-3.5 text-zinc-600" />
                          <span className="text-xs text-zinc-500 font-medium">{video.views}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-zinc-600" />
                          <span className="text-xs text-zinc-500 font-medium">{video.exercises_count} treinos</span>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <button className="flex-1 py-2 rounded-xl bg-zinc-800 text-zinc-400 text-[0.6875rem] font-bold hover:text-white transition-colors border border-white/5">Editar</button>
                        <button className="flex-1 py-2 rounded-xl bg-red-500/10 text-red-500 text-[0.6875rem] font-bold hover:bg-red-500/20 transition-colors border border-red-500/10">Excluir</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-600">
              <div className="w-20 h-20 rounded-full bg-zinc-900 flex items-center justify-center mb-6">
                <BookOpen className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Selecione um curso</h3>
              <p className="text-sm max-w-xs text-center">Escolha um curso na lista ao lado para gerenciar as aulas e conteúdos.</p>
            </div>
          )
        ) : selectedStudent ? (
          <>
            {/* Header Global */}
            <header className="h-20 border-b border-white/5 flex items-center justify-between px-8 bg-[#0d0d0d]/30 backdrop-blur-md">
              <div className="flex items-center gap-6">
                <h2 className="text-xl font-bold">Alunos <span className="text-zinc-500">({selectedStudent.instrument})</span></h2>
                <div className="flex gap-3">
                  <div className="px-3 py-1.5 rounded-full bg-[#22c55e]/10 border border-[#22c55e]/20 flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-[#22c55e]" />
                    <span className="text-[0.6875rem] font-bold text-[#22c55e]">Alunos Ativos: 48</span>
                  </div>
                  <div className="px-3 py-1.5 rounded-full bg-[#f97316]/10 border border-[#f97316]/20 flex items-center gap-2">
                    <MessageCircle className="w-3.5 h-3.5 text-[#f97316]" />
                    <span className="text-[0.6875rem] font-bold text-[#f97316]">Treinos Pendentes: 7</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center bg-zinc-900 rounded-xl p-1 border border-white/5">
                <button 
                  onClick={() => setViewMode('chat')}
                  className={cn(
                    "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                    viewMode === 'chat' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-white"
                  )}
                >
                  Chat
                </button>
                <button 
                  onClick={() => setViewMode('lessons')}
                  className={cn(
                    "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                    viewMode === 'lessons' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-white"
                  )}
                >
                  Gerenciar Aulas
                </button>
              </div>
            </header>

            <div className="flex-1 flex overflow-hidden">
              {/* Chat View */}
              {viewMode === 'chat' && (
                <div className="flex-1 flex flex-col relative bg-[#050505]">
                  <div className="p-4 border-b border-white/5 flex items-center gap-3 bg-[#0d0d0d]/20">
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-zinc-800">
                      <img src={selectedStudent.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedStudent.full_name}`} alt={selectedStudent.full_name} className="w-full h-full object-cover" />
                    </div>
                    <span className="font-bold text-sm">{selectedStudent.full_name}</span>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {messages.map((msg) => {
                      const isMe = msg.sender_id !== selectedStudent.id;
                      return (
                        <div key={msg.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                          <div className={cn(
                            "max-w-[70%] px-4 py-3 rounded-2xl relative",
                            isMe 
                              ? "bg-gradient-to-r from-[#22c55e] to-[#f97316] text-white rounded-tr-none" 
                              : "bg-zinc-900 border border-[#f97316]/20 text-white rounded-tl-none"
                          )}>
                            {msg.type === 'video' && (
                              <div className="flex flex-col gap-2 min-w-[14rem] mb-2">
                                <div className="relative aspect-video rounded-xl overflow-hidden bg-black/20 group cursor-pointer">
                                  <img src={msg.thumbnail_url || "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400"} alt="Video" className="w-full h-full object-cover opacity-80" />
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border border-white/40 group-hover:scale-110 transition-transform">
                                      <Play className="w-5 h-5 text-white fill-white" />
                                    </div>
                                  </div>
                                </div>
                                <span className="text-[0.75rem] font-bold opacity-90 truncate">{msg.file_name || "Treino.mp4"}</span>
                              </div>
                            )}
                            <p className="text-sm leading-relaxed">{msg.content}</p>
                            <span className="text-[0.625rem] opacity-50 mt-1 block text-right">
                              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Input Bar */}
                  <div className="p-6 bg-gradient-to-t from-black to-transparent">
                    <div className="relative max-w-4xl mx-auto">
                      <div className="absolute -inset-[1px] bg-gradient-to-r from-[#22c55e] via-[#f97316] to-[#ef4444] rounded-2xl opacity-20 blur-sm" />
                      <div className="relative flex items-center gap-2 bg-zinc-900/90 backdrop-blur-xl p-2 rounded-2xl border border-white/10 shadow-2xl">
                        <button className="p-3 text-zinc-400 hover:text-white transition-colors">
                          <Paperclip className="w-5 h-5" />
                        </button>
                        <input 
                          type="text"
                          placeholder="Digite sua mensagem..."
                          className="flex-1 bg-transparent border-none focus:ring-0 text-sm placeholder:text-zinc-600"
                        />
                        <button className="p-3 text-zinc-400 hover:text-white transition-colors">
                          <Smile className="w-5 h-5" />
                        </button>
                        <button className="w-11 h-11 bg-gradient-to-r from-[#22c55e] to-[#f97316] rounded-xl flex items-center justify-center shadow-lg active:scale-95 transition-all">
                          <Mic className="w-5 h-5 text-white" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Lessons Management View */}
              {viewMode === 'lessons' && (
                <div className="flex-1 flex flex-col bg-[#050505]">
                  <div className="p-6 border-b border-white/5 flex items-center justify-between bg-[#0d0d0d]/20">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
                      <h3 className="font-bold text-sm">Gerenciando Aulas: {selectedStudent.full_name} ({selectedStudent.instrument})</h3>
                    </div>
                    {/* Mini VU Meter Horizontal */}
                    <div className="flex gap-[2px] items-end h-4">
                      {[...Array(20)].map((_, i) => (
                        <div key={i} className={cn("w-[3px] rounded-full", i < 15 ? "bg-[#22c55e]" : i < 18 ? "bg-[#f97316]" : "bg-zinc-800")} style={{ height: `${30 + (i * 3.5)}%` }} />
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-8 space-y-6">
                    {modules.map((module) => (
                      <div key={module.id} className="rounded-2xl border border-white/5 bg-zinc-900/20 overflow-hidden">
                        <button 
                          onClick={() => setOpenModules(prev => prev.includes(module.id) ? prev.filter(id => id !== module.id) : [...prev, module.id])}
                          className="w-full p-5 flex items-center justify-between hover:bg-white/5 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center">
                              <BookOpen className="w-4 h-4 text-zinc-400" />
                            </div>
                            <span className="font-bold">{module.title}</span>
                          </div>
                          {openModules.includes(module.id) ? <ChevronUp className="w-5 h-5 text-zinc-500" /> : <ChevronDown className="w-5 h-5 text-zinc-500" />}
                        </button>

                        {openModules.includes(module.id) && (
                          <div className="px-5 pb-5 grid grid-cols-1 gap-3">
                            {module.lessons.map((lesson) => (
                              <div key={lesson.id} className={cn(
                                "flex items-center justify-between p-4 rounded-xl border transition-all",
                                lesson.is_locked ? "bg-black/40 border-white/5" : "bg-[#22c55e]/5 border-[#22c55e]/20"
                              )}>
                                <div className="flex items-center gap-4">
                                  <div className="w-12 h-12 rounded-lg bg-black/40 flex items-center justify-center overflow-hidden relative">
                                    <Video className="w-5 h-5 text-zinc-600" />
                                    <div className="absolute inset-0 bg-black/20" />
                                  </div>
                                  <div>
                                    <p className={cn("text-sm font-bold", lesson.is_locked ? "text-zinc-500" : "text-white")}>{lesson.title}</p>
                                    <span className="text-[0.625rem] text-zinc-600 font-bold uppercase tracking-wider">Video Aula</span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-4">
                                  <span className={cn("text-[0.6875rem] font-bold uppercase tracking-wider", lesson.is_locked ? "text-zinc-600" : "text-[#22c55e]")}>
                                    {lesson.is_locked ? "Bloqueada" : "Liberada"}
                                  </span>
                                  <button 
                                    onClick={() => toggleLessonLock(lesson.id, lesson.is_locked)}
                                    className={cn(
                                      "w-12 h-6 rounded-full relative transition-all duration-300",
                                      lesson.is_locked ? "bg-zinc-800" : "bg-[#22c55e]"
                                    )}
                                  >
                                    <div className={cn(
                                      "absolute top-1 w-4 h-4 rounded-full bg-white transition-all duration-300 shadow-sm",
                                      lesson.is_locked ? "left-1" : "left-7"
                                    )} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-600">
            <div className="w-20 h-20 rounded-full bg-zinc-900 flex items-center justify-center mb-6">
              <Users className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Selecione um aluno</h3>
            <p className="text-sm max-w-xs text-center">Escolha um aluno na lista ao lado para gerenciar suas aulas ou enviar mensagens.</p>
          </div>
        )}
      </main>

      {/* Modal de Cadastro (Adaptado do original) */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-zinc-900 rounded-[2.5rem] border border-white/5 p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-2xl font-bold text-white">Novo Aluno</h2>
                <p className="text-zinc-500 text-sm">Preencha os dados para criar o acesso.</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                <X size={20}/>
              </button>
            </div>

            <form onSubmit={handleAddStudent} className="flex flex-col gap-4">
              <div className="space-y-1">
                <label className="text-[0.625rem] font-bold text-zinc-500 uppercase ml-4">Nome Completo</label>
                <input 
                  placeholder="Ex: João Silva" 
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  required
                  className="w-full h-14 bg-zinc-800/50 border border-white/5 px-6 rounded-2xl text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors"
                />
              </div>
              
              <div className="space-y-1">
                <label className="text-[0.625rem] font-bold text-zinc-500 uppercase ml-4">Usuário</label>
                <input 
                  placeholder="Ex: joao.silva" 
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  className="w-full h-14 bg-zinc-800/50 border border-white/5 px-6 rounded-2xl text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[0.625rem] font-bold text-zinc-500 uppercase ml-4">Senha</label>
                <div className="relative">
                  <input 
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••" 
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    className="w-full h-14 bg-zinc-800/50 border border-white/5 px-6 rounded-2xl text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-6 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[0.625rem] font-bold text-zinc-500 uppercase ml-4">Instrumento</label>
                <select 
                  value={instrument}
                  onChange={e => setInstrument(e.target.value)}
                  className="w-full h-14 bg-zinc-800/50 border border-white/5 px-6 rounded-2xl text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors appearance-none"
                >
                  <option>Guitarra</option>
                  <option>Violão</option>
                  <option>Bateria</option>
                  <option>Baixo</option>
                  <option>Teclado</option>
                  <option>Ukulele</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-14 rounded-2xl font-bold text-white transition-all active:scale-[0.98] mt-4 flex items-center justify-center bg-gradient-to-r from-[#22c55e] to-[#16a34a] shadow-lg shadow-green-500/10"
              >
                {loading ? <Loader2 className="animate-spin" size={20} /> : "CADASTRAR ALUNO"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}