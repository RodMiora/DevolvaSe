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
  ChevronLeft,
  X,
  Loader2,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  Menu
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
  receiver_id: string;
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
  description?: string;
  instrument_id?: string;
  order?: number;
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
  name: string;
  icon_url?: string;
  created_at: string;
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
  const [allModules, setAllModules] = useState<Module[]>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  const [openModules, setOpenModules] = useState<string[]>([]);
  const messagesChannelRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showAddCourseModal, setShowAddCourseModal] = useState(false);
  const [showEditCourseModal, setShowEditCourseModal] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileDetailsView, setIsMobileDetailsView] = useState(false);

  // Handlers for mobile navigation
  const handleSelectStudent = (student: any) => {
    setSelectedStudent(student);
    setIsMobileDetailsView(true);
  };

  const handleSelectCourse = (course: any) => {
    setSelectedCourse(course);
    setIsMobileDetailsView(true);
    fetchCourseVideos(course.id);
  };

  const handleBackToList = () => {
    setSelectedStudent(null);
    setSelectedCourse(null);
    setIsMobileDetailsView(false);
  };
  
  // Add Student Form State
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [instrument, setInstrument] = useState("Guitarra");
  const [showPassword, setShowPassword] = useState(false);
  
  // Upload Video Form State
  const [videoTitle, setVideoTitle] = useState("");
  const [videoDescription, setVideoDescription] = useState("");
  const [selectedModule, setSelectedModule] = useState("");
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [courseModules, setCourseModules] = useState<Module[]>([]);

  // Add/Edit Course Form State
  const [courseName, setCourseName] = useState("");
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);

  // Add/Edit Module Form State
  const [showAddModuleModal, setShowAddModuleModal] = useState(false);
  const [selectedCourseForModule, setSelectedCourseForModule] = useState<string | null>(null);
  const [moduleTitle, setModuleTitle] = useState("");
  const [moduleDescription, setModuleDescription] = useState("");
  
  // Configurações states
  const [teacherProfile, setTeacherProfile] = useState<any>(null);
  const [teacherName, setTeacherName] = useState("");
  const [teacherInstruments, setTeacherInstruments] = useState("");
  const [teacherAvatar, setTeacherAvatar] = useState("");
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [theme, setTheme] = useState("dark"); // Initialize with default
  const [themeLoaded, setThemeLoaded] = useState(false); // To track when we get theme from localStorage
  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Load theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem("app_theme") || "dark";
    setTheme(savedTheme);
    setThemeLoaded(true);
  }, []);

  // Apply theme on mount and when theme changes
  useEffect(() => {
    if (!themeLoaded) return;
    localStorage.setItem("app_theme", theme);
    
    // Set CSS variables that are actually used in globals.css
    if (theme === "light") {
      document.documentElement.style.setProperty('--background', '#ffffff');
      document.documentElement.style.setProperty('--foreground', '#000000');
      document.documentElement.style.setProperty('--surface', '#f0f0f0');
      document.documentElement.style.setProperty('--text-secondary', '#666666');
    } else if (theme === "neon") {
      document.documentElement.style.setProperty('--background', '#0a0a0a');
      document.documentElement.style.setProperty('--foreground', '#ffffff');
      document.documentElement.style.setProperty('--surface', '#1a1a2e');
      document.documentElement.style.setProperty('--text-secondary', '#8888ff');
    } else {
      // Dark default
      document.documentElement.style.setProperty('--background', '#0A0A0A');
      document.documentElement.style.setProperty('--foreground', '#ffffff');
      document.documentElement.style.setProperty('--surface', '#1A1A1A');
      document.documentElement.style.setProperty('--text-secondary', '#888888');
    }
  }, [theme, themeLoaded]);

  useEffect(() => {
    fetchStudents();
    fetchCourses();
    fetchAllModules();
    
    // Get teacher's ID from auth and fetch profile
    const getTeacherIdAndProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setTeacherId(user.id);
        // Fetch teacher profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        
        if (profile) {
                          setTeacherProfile(profile);
                          setTeacherName(profile.full_name || "");
                          setTeacherInstruments(profile.instrument || "");
                          setTeacherAvatar(profile.avatar_url || "");
                        }
      }
    };
    getTeacherIdAndProfile();
    
    // Clean up on unmount
    return () => {
      if (messagesChannelRef.current) {
        supabase.removeChannel(messagesChannelRef.current);
      }
    };
  }, []);

  const fetchAllModules = async () => {
    try {
      const { data, error } = await supabase
        .from('modules')
        .select('*')
        .order('order', { ascending: true });
      
      if (error) throw error;
      
      setAllModules((data || []).map((m: any) => ({ 
        id: m.id, 
        title: m.title, 
        description: m.description, 
        instrument_id: m.instrument_id, 
        order: m.order, 
        lessons: [] 
      })));
    } catch (error) {
      console.error('Error fetching all modules:', error);
    }
  };

  const fetchCourses = async () => {
    try {
      const { data, error } = await supabase
        .from('instruments')
        .select('*')
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      
      console.log('fetchCourses data:', data);
      setCourses(data || []);
    } catch (error) {
      console.error('Error fetching courses:', error);
    }
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
    console.log('useEffect selectedCourse changed:', selectedCourse);
    if (selectedCourse) {
      fetchCourseVideos(selectedCourse.id);
      fetchCourseModules(selectedCourse.id);
    }
  }, [selectedCourse]);

  const fetchCourseModules = async (courseId: string) => {
    try {
      const { data, error } = await supabase
        .from('modules')
        .select('*')
        .eq('instrument_id', courseId)
        .order('order', { ascending: true });
      
      if (error) throw error;
      
      setCourseModules((data || []).map((m: any) => ({ 
        id: m.id, 
        title: m.title, 
        description: m.description, 
        instrument_id: m.instrument_id, 
        order: m.order, 
        lessons: [] 
      })));
    } catch (error) {
      console.error('Error fetching modules:', error);
    }
  };

  useEffect(() => {
    console.log("selectedStudent changed:", selectedStudent, "teacherId:", teacherId);
    if (selectedStudent && teacherId) {
      const studentUserId = selectedStudent.id;
      console.log("Calling fetchMessages for student:", studentUserId);
      fetchMessages(studentUserId);
      fetchStudentLessons(selectedStudent.id, selectedStudent.instrument);
      
      // Clean up previous channel if it exists
      if (messagesChannelRef.current) {
        supabase.removeChannel(messagesChannelRef.current);
      }
      
      // Subscribe to real-time messages
      const channel = supabase
        .channel(`chat:${studentUserId}`)
        .on('postgres_changes', { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'chat_messages'
        }, payload => {
          const newMsg = payload.new as Message;
          // Only add message if it's part of the conversation between teacher and student
          if (
            (newMsg.sender_id === teacherId && newMsg.receiver_id === studentUserId) ||
            (newMsg.sender_id === studentUserId && newMsg.receiver_id === teacherId)
          ) {
            setMessages(prev => [...prev, newMsg]);
          }
        })
        .subscribe();

      messagesChannelRef.current = channel;

      return () => {
        if (messagesChannelRef.current) {
          supabase.removeChannel(messagesChannelRef.current);
          messagesChannelRef.current = null;
        }
      };
    }
  }, [selectedStudent, courses, teacherId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    console.log("Auto-scrolling to bottom, scrollRef:", scrollRef.current);
    if (scrollRef.current) {
      scrollRef.current.scrollTo(0, scrollRef.current.scrollHeight);
    }
  }, [messages]);

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

  const fetchMessages = async (studentUserId: string) => { 
    if (!teacherId || !studentUserId) return; 
 
    const studentAuthId = studentUserId; 
 
    // Busca todas as mensagens trocadas estritamente entre este professor e este aluno 
    const { data, error } = await supabase 
      .from('chat_messages') 
      .select('*') 
      .or(`and(sender_id.eq.${teacherId},receiver_id.eq.${studentAuthId}),and(sender_id.eq.${studentAuthId},receiver_id.eq.${teacherId})`) 
      .order('created_at', { ascending: true }); 
 
    if (error) { 
      console.error('Erro ao buscar mensagens do professor:', error); 
    } else if (data) { 
      setMessages(data); 
    } 
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !selectedStudent) return;
    
    // Primeiro, vamos pegar o ID do usuário autenticado (professor)
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Validate that sender_id and receiver_id are valid
    if (!user.id || !selectedStudent.id) {
      alert("IDs de usuário inválidos!");
      return;
    }

    try {
      // Create a temporary local message for optimistic update
      const tempId = `temp_${Date.now()}`;
      const tempMessage = {
        id: tempId,
        sender_id: user.id,
        receiver_id: selectedStudent.id,
        content: chatInput.trim(),
        type: 'text' as const,
        created_at: new Date().toISOString()
      } as any;

      // Optimistic update: add to local state immediately
      setMessages(prev => [...prev, tempMessage]);
      
      // Clear input right away
      const inputValue = chatInput;
      setChatInput("");

      const messageData = {
        sender_id: user.id,
        receiver_id: selectedStudent.id,
        content: inputValue.trim(),
        type: 'text' as const
      };

      const { error } = await supabase
        .from('chat_messages')
        .insert(messageData);

      if (error) {
        // Rollback optimistic update on error
        setMessages(prev => prev.filter(m => m.id !== tempId));
        throw error;
      }
    } catch (err) {
      console.error("Erro ao enviar mensagem:", err);
      alert("Erro ao enviar mensagem: " + (err as Error).message);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedStudent) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const formData = new FormData();
    formData.append('sender_id', user.id);
    formData.append('receiver_id', selectedStudent.id);
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:8000/upload-chat-file', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error('Erro no upload do arquivo');
      
      const result = await response.json();
      
      // Determine message type based on file type
      let messageType: 'audio' | 'video' | 'text' = 'text';
      if (file.type.startsWith('video/')) {
        messageType = 'video';
      } else if (file.type.startsWith('audio/')) {
        messageType = 'audio';
      }

      // Save message to Supabase
      await supabase.from('chat_messages').insert({
        sender_id: user.id,
        receiver_id: selectedStudent.id,
        content: result.file_url,
        type: messageType,
        file_name: result.file_name,
        media_url: result.file_url
      });
    } catch (err) {
      console.error('Erro ao enviar arquivo:', err);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        await sendAudioMessage(audioBlob);
      };

      setMediaRecorder(recorder);
      setAudioChunks(chunks);
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Erro ao iniciar gravação:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
  };

  const sendAudioMessage = async (audioBlob: Blob) => {
    if (!selectedStudent) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const formData = new FormData();
    formData.append('sender_id', user.id);
    formData.append('receiver_id', selectedStudent.id);
    formData.append('audio', audioBlob, 'audio.webm');

    try {
      const response = await fetch('http://localhost:8000/upload-audio', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error('Erro no upload do áudio');
      
      const result = await response.json();

      // Save message to Supabase
      await supabase.from('chat_messages').insert({
        sender_id: user.id,
        receiver_id: selectedStudent.id,
        content: result.audio_url,
        type: 'audio',
        file_name: 'Áudio gravado',
        media_url: result.audio_url
      });
    } catch (err) {
      console.error('Erro ao enviar áudio:', err);
    }
  };

  const fetchStudentLessons = async (studentId: string, studentInstrumentName?: string) => {
    // Encontra o curso (instrumento) correspondente ao instrumento do aluno
    const studentCourse = courses.find(c => c.name.toLowerCase() === studentInstrumentName?.toLowerCase());
    
    // Busca apenas os módulos do instrumento do aluno
    let modulesQuery = supabase.from('modules').select('*, lessons(*)');
    if (studentCourse) {
      modulesQuery = modulesQuery.eq('instrument_id', studentCourse.id);
    }
    
    const { data: modulesData } = await modulesQuery;
    
    const { data: accessData } = await supabase
      .from('student_lessons')
      .select('*')
      .eq('student_id', studentId);

    if (modulesData) {
      const formattedModules = modulesData.map(mod => ({
        id: mod.id,
        title: mod.title,
        description: mod.description,
        instrument_id: mod.instrument_id,
        order: mod.order,
        lessons: (mod.lessons || []).map((lesson: any) => {
          const access = (accessData || []).find(a => a.lesson_id === lesson.id);
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
        lessons: (mod.lessons || []).map(l => l.id === lessonId ? { ...l, is_locked: !currentLocked } : l)
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

  const handleAddCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Iniciando criacao do instrumento...', courseName);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('instruments')
        .insert([{ name: courseName }])
        .select();
      
      if (error) throw error;
      
      console.log('Curso criado com sucesso:', data);
      setShowAddCourseModal(false);
      setCourseName("");
      fetchCourses();
    } catch (err: any) {
      console.error('Erro ao criar curso:', err);
      alert('Erro ao criar curso: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEditCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCourse) return;
    console.log('Iniciando edição do curso...', courseName);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('instruments')
        .update({ name: courseName })
        .eq('id', editingCourse.id)
        .select();
      
      if (error) throw error;
      
      console.log('Curso editado com sucesso:', data);
      setShowEditCourseModal(false);
      setCourseName("");
      setEditingCourse(null);
      fetchCourses();
    } catch (err: any) {
      console.error('Erro ao editar curso:', err);
      alert('Erro ao editar curso: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCourse = async (courseId: string) => {
    if (!confirm('Tem certeza que deseja apagar este curso?')) return;
    console.log('Iniciando exclusão do curso...', courseId);
    try {
      const { error } = await supabase
        .from('instruments')
        .delete()
        .eq('id', courseId);
      
      if (error) throw error;
      
      console.log('Curso excluído com sucesso');
      fetchCourses();
      if (selectedCourse?.id === courseId) {
        setSelectedCourse(null);
      }
    } catch (err: any) {
      console.error('Erro ao excluir curso:', err);
      alert('Erro ao excluir curso: ' + err.message);
    }
  };

  const handleAddModule = async (e: React.FormEvent) => {
  e.preventDefault();
  
  // Tenta pegar o ID do curso selecionado no estado global, do seletor do modal ou de uma variável de suporte
  const targetCourseId = 
    selectedCourse?.id || 
    (typeof selectedCourseForModule !== 'undefined' ? selectedCourseForModule : null) || 
    (window as any).selectedCourseForModuleId;

  console.log('handleAddModule called!', { selectedCourse, selectedCourseForModule, targetCourseId, moduleTitle, moduleDescription });

  if (!targetCourseId) {
    console.error('Nenhum curso selecionado!');
    alert('Por favor, selecione um curso na lista lateral ou no campo de seleção antes de adicionar um módulo!');
    return;
  }

  console.log('Iniciando criação do módulo...', targetCourseId, moduleTitle);
  setLoading(true);
  try {
    // 1. Busca a maior ordem atual para este instrumento
    const { data: existingModules, error: fetchError } = await supabase
      .from('modules')
      .select('order')
      .eq('instrument_id', targetCourseId)
      .order('order', { ascending: false })
      .limit(1);
      
    if (fetchError) throw fetchError;
    
    const nextOrder = existingModules && existingModules.length > 0 ? (existingModules[0].order || 0) + 1 : 1;
    
    // 2. Insere o novo módulo no Supabase
    const { data, error } = await supabase
      .from('modules')
      .insert([{ 
        instrument_id: targetCourseId, 
        title: moduleTitle, 
        description: moduleDescription,
        order: nextOrder
      }])
      .select();
      
    if (error) throw error;
    
    console.log('Módulo criado com sucesso:', data);
    alert('Módulo criado com sucesso!');
    
    setShowAddModuleModal(false);
    setModuleTitle("");
    setModuleDescription("");
    if (typeof setSelectedCourseForModule === 'function') {
      setSelectedCourseForModule(null);
    }
    
    // Atualiza a lista de módulos do curso correspondente e todos os módulos
    fetchCourseModules(targetCourseId);
    fetchAllModules();
  } catch (err: any) {
    console.error('Erro ao criar módulo:', err);
    alert('Erro ao criar módulo: ' + err.message);
  } finally {
    setLoading(false);
  }
};

  const handleUploadVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedModule || !selectedVideoFile) return;
    
    console.log('Iniciando upload do vídeo...', videoTitle);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('module_id', selectedModule);
      formData.append('title', videoTitle);
      formData.append('description', videoDescription);
      formData.append('video', selectedVideoFile);

      const response = await fetch('http://localhost:8000/upload-lesson-video', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Vídeo enviado com sucesso:', data);
        setShowUploadModal(false);
        setVideoTitle("");
        setVideoDescription("");
        setSelectedModule("");
        setSelectedVideoFile(null);
        // Refresh course videos if needed
        if (selectedCourse) {
          fetchCourseVideos(selectedCourse.id);
        }
      } else {
        const errorText = await response.text();
        console.error('Erro na resposta do servidor:', errorText);
      }
    } catch (err) {
      console.error('Erro ao enviar vídeo:', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-white overflow-hidden font-sans">
      {/* Overlay para menu mobile */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
      
      {/* COLUNA 1 - Menu Lateral */}
      <aside className={cn(
        "fixed md:relative z-50 w-64 h-full border-r border-white/5 flex flex-col bg-[#0d0d0d] transition-transform duration-300",
        isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-end gap-[2px] h-6">
              {[0.4, 0.7, 1, 0.6, 0.8].map((h, i) => (
                <div key={i} className="w-1 bg-gradient-to-t from-[#22c55e] via-[#f97316] to-[#ef4444] rounded-full" style={{ height: `${h * 100}%` }} />
              ))}
            </div>
            <span className="text-xl font-bold tracking-tight">DevolvaSe</span>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden p-2 text-zinc-500 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
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
              onClick={() => {
                setActiveTab(item.id as any);
                setIsMobileMenuOpen(false);
                setIsMobileDetailsView(false);
                setSelectedStudent(null);
                setSelectedCourse(null);
              }}
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
                <img 
                  src={teacherAvatar || teacherProfile?.avatar_url || "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100"} 
                  alt="Avatar" 
                  className="w-full h-full object-cover" 
                />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{teacherName || teacherProfile?.full_name || "Professor"}</p>
              <p className="text-[0.625rem] text-zinc-500 uppercase tracking-widest font-bold">{teacherInstruments || teacherProfile?.instrument || ""}</p>
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
      <section className={cn(
        "w-full md:w-80 border-r border-white/5 flex flex-col bg-[#0d0d0d]/50",
        isMobileDetailsView ? "hidden md:flex" : "flex"
      )}>
        <div className="p-6 space-y-4">
          {/* Botão hambúrguer para mobile */}
          <div className="flex items-center gap-4 md:hidden">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 bg-zinc-800 rounded-full text-white hover:bg-zinc-700 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3">
              <div className="flex items-end gap-[2px] h-6">
                {[0.4, 0.7, 1, 0.6, 0.8].map((h, i) => (
                  <div key={i} className="w-1 bg-gradient-to-t from-[#22c55e] via-[#f97316] to-[#ef4444] rounded-full" style={{ height: `${h * 100}%` }} />
                ))}
              </div>
              <span className="text-xl font-bold tracking-tight">DevolvaSe</span>
            </div>
          </div>
          
          {/* Conteúdo da COLUNA 2 baseado no activeTab */}
          {activeTab === 'dashboard' ? (
            <div className="flex flex-col gap-1">
              <h3 className="text-xl font-bold">Bem-vindo!</h3>
              <p className="text-zinc-500 text-xs">Veja o resumo do seu ensino na área ao lado.</p>
            </div>
          ) : activeTab === 'config' ? (
            <div className="flex flex-col gap-1">
              <h3 className="text-xl font-bold">Configurações</h3>
              <p className="text-zinc-500 text-xs">Ajuste o seu perfil e preferências.</p>
            </div>
          ) : activeTab === 'cursos' ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">Meus Cursos</h3>
                <button
                  onClick={() => setShowAddCourseModal(true)}
                  className="p-2 bg-[#22c55e] rounded-full text-black hover:bg-[#16a34a] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <p className="text-zinc-500 text-xs">Gerencie seu conteúdo por Instrumento.</p>
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

          {/* Search (apenas para cursos e alunos) */}
          {(activeTab === 'cursos' || activeTab === 'alunos') && (
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input 
                type="text"
                placeholder={activeTab === 'cursos' ? "Buscar curso..." : "Buscar aluno..."}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-900/50 border border-white/5 rounded-xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors"
              />
            </div>
          )}
        </div>

        {/* List (apenas para cursos e alunos) */}
        {(activeTab === 'cursos' || activeTab === 'alunos') && (
          <div className="flex-1 overflow-y-auto px-4 space-y-2 pb-6">
          {activeTab === 'cursos' ? (
            courses.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())).map((course) => (
              <div
                key={course.id}
                className={cn(
                  "w-full p-4 rounded-2xl border transition-all duration-200 flex items-center justify-between group relative",
                  selectedCourse?.id === course.id 
                    ? "bg-zinc-900 border-[#22c55e]/30 shadow-[0_0_20px_rgba(34,197,94,0.05)]" 
                    : "bg-transparent border-transparent hover:bg-white/5"
                )}
              >
                <button
                  onClick={() => handleSelectCourse(course)}
                  className="flex items-center gap-4 flex-1 text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center">
                    <BookOpen className="w-6 h-6 text-zinc-500" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm truncate">{course.name}</h4>
                    <p className="text-[0.6875rem] text-zinc-500 font-medium">{allModules.filter(m => m.instrument_id === course.id).length} Módulos • {course.name}</p>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingCourse(course);
                      setCourseName(course.name);
                      setShowEditCourseModal(true);
                    }}
                    className="p-2 text-zinc-500 hover:text-[#22c55e] transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCourse(course.id);
                    }}
                    className="p-2 text-zinc-500 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          ) : (
            students.filter(s => s.full_name.toLowerCase().includes(searchQuery.toLowerCase())).map((student) => (
              <button
                key={student.id}
                onClick={() => handleSelectStudent(student)}
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
        )}
      </section>

      {/* COLUNA 3 - Área de Ação */}
      <main className={cn(
        "flex-1 flex flex-col bg-black relative",
        (activeTab === 'dashboard' || activeTab === 'config') ? "flex" : 
        (isMobileDetailsView ? "flex" : "hidden md:flex")
      )}>
        {activeTab === 'dashboard' ? (
          <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
            {/* Header da Dashboard */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">Dashboard</h2>
                <p className="text-sm text-zinc-500 mt-1">Resumo geral do seu ensino</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setShowAddModal(true)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-white font-bold text-sm hover:bg-zinc-700 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar Aluno
                </button>
                <button 
                  onClick={() => setShowAddCourseModal(true)}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-white font-bold text-sm shadow-lg shadow-green-500/10 active:scale-[0.98] transition-all flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar Curso
                </button>
              </div>
            </div>

            {/* Cards de Métricas */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[#22c55e]/10 flex items-center justify-center">
                    <Users className="w-5 h-5 text-[#22c55e]" />
                  </div>
                </div>
                <p className="text-2xl font-bold">{students.length}</p>
                <p className="text-xs text-zinc-500 mt-1">Total de Alunos</p>
              </div>
              <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[#f97316]/10 flex items-center justify-center">
                    <Users className="w-5 h-5 text-[#f97316]" />
                  </div>
                </div>
                <p className="text-2xl font-bold">48</p>
                <p className="text-xs text-zinc-500 mt-1">Alunos Ativos</p>
              </div>
              <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[#3b82f6]/10 flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-[#3b82f6]" />
                  </div>
                </div>
                <p className="text-2xl font-bold">{courses.length}</p>
                <p className="text-xs text-zinc-500 mt-1">Cursos</p>
              </div>
              <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[#ef4444]/10 flex items-center justify-center">
                    <MessageCircle className="w-5 h-5 text-[#ef4444]" />
                  </div>
                </div>
                <p className="text-2xl font-bold">7</p>
                <p className="text-xs text-zinc-500 mt-1">Treinos Pendentes</p>
              </div>
            </div>

            {/* Últimas Atividades */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-5">
                <h3 className="font-bold mb-4">Últimas Mensagens</h3>
                <div className="space-y-3">
                  {students.slice(0, 3).map((student) => (
                    <div key={student.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors cursor-pointer" onClick={() => { setActiveTab('alunos'); setSelectedStudent(student); }}>
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-800">
                        <img src={student.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${student.full_name}`} alt={student.full_name} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">{student.full_name}</p>
                        <p className="text-xs text-zinc-500">Última conversa: Hoje</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-5">
                <h3 className="font-bold mb-4">Cursos Recentes</h3>
                <div className="space-y-3">
                  {courses.slice(0, 3).map((course) => (
                    <div key={course.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors cursor-pointer" onClick={() => { setActiveTab('cursos'); setSelectedCourse(course); }}>
                      <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
                        <BookOpen className="w-5 h-5 text-zinc-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">{course.name}</p>
                        <p className="text-xs text-zinc-500">Criado em {new Date(course.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === 'config' ? (
          <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
            {/* Header das Configurações */}
            <div>
              <h2 className="text-2xl font-bold">Configurações</h2>
              <p className="text-sm text-zinc-500 mt-1">Ajuste o seu perfil e preferências</p>
            </div>

            {/* Seção Perfil */}
            <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-5">
              <h3 className="font-bold mb-4">Perfil do Professor</h3>
              <div className="space-y-4">
                {/* Avatar */}
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full overflow-hidden bg-zinc-800">
                      <img 
                        src={teacherAvatar || "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100"} 
                        alt="Avatar" 
                        className="w-full h-full object-cover" 
                      />
                    </div>
                    <label className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-[#22c55e] flex items-center justify-center cursor-pointer hover:bg-[#16a34a] transition-colors">
                      <Plus className="w-4 h-4 text-black" />
                      <input 
                        type="file" 
                        className="hidden" 
                        accept="image/*" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => setTeacherAvatar(reader.result as string);
                            reader.readAsDataURL(file);
                          }
                        }} 
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Nome</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-3 rounded-xl bg-zinc-800 border border-white/5 text-sm focus:outline-none focus:border-[#22c55e]/50"
                    placeholder="Seu nome"
                    value={teacherName}
                    onChange={(e) => setTeacherName(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Instrumentos que Ensina</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-3 rounded-xl bg-zinc-800 border border-white/5 text-sm focus:outline-none focus:border-[#22c55e]/50"
                    placeholder="Ex: Guitarra, Piano"
                    value={teacherInstruments}
                    onChange={(e) => setTeacherInstruments(e.target.value)}
                  />
                </div>

                <button 
                  disabled={savingProfile}
                  onClick={async () => {
                    if (!teacherId) return;
                    setSavingProfile(true);
                    
                    try {
                      console.log('Attempting to update profile with:', {
                        teacherId,
                        full_name: teacherName,
                        instrument: teacherInstruments,
                        avatar_url: teacherAvatar
                      });
                      
                      // Update profile in Supabase
                      const { data, error } = await supabase
                        .from('profiles')
                        .update({
                          full_name: teacherName,
                          instrument: teacherInstruments,
                          avatar_url: teacherAvatar
                        })
                        .eq('id', teacherId)
                        .select();
                      
                      console.log('Supabase update response:', { data, error });
                      
                      if (error) throw error;
                      
                      // Update local profile state
                      setTeacherProfile((prev: any) => ({
                        ...prev,
                        full_name: teacherName,
                        instrument: teacherInstruments,
                        avatar_url: teacherAvatar
                      }));
                      
                      alert("Perfil atualizado com sucesso!");
                    } catch (err) {
                      console.error('Erro ao salvar perfil:', err);
                      alert(`Erro ao salvar perfil: ${(err as Error)?.message || JSON.stringify(err)}`);
                    } finally {
                      setSavingProfile(false);
                    }
                  }}
                  className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-sm font-bold hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingProfile ? "Salvando..." : "Salvar Alterações"}
                </button>
              </div>
            </div>

            {/* Seção Preferências - Tema */}
            <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-5">
              <h3 className="font-bold mb-4">Tema do App</h3>
              <div className="grid grid-cols-3 gap-4">
                <button 
                  onClick={() => setTheme("dark")}
                  className={cn(
                    "p-4 rounded-xl border transition-all",
                    theme === "dark" 
                      ? "bg-zinc-800 border-[#22c55e]/50" 
                      : "bg-zinc-800/50 border-transparent hover:border-white/10"
                  )}
                >
                  <div className="w-full h-20 bg-black rounded-lg mb-2 border border-zinc-800" />
                  <p className="text-xs font-bold">Escuro</p>
                </button>

                <button 
                  onClick={() => setTheme("light")}
                  className={cn(
                    "p-4 rounded-xl border transition-all",
                    theme === "light" 
                      ? "bg-zinc-800 border-[#22c55e]/50" 
                      : "bg-zinc-800/50 border-transparent hover:border-white/10"
                  )}
                >
                  <div className="w-full h-20 bg-white rounded-lg mb-2 border border-zinc-200" />
                  <p className="text-xs font-bold">Claro</p>
                </button>

                <button 
                  onClick={() => setTheme("neon")}
                  className={cn(
                    "p-4 rounded-xl border transition-all",
                    theme === "neon" 
                      ? "bg-zinc-800 border-[#22c55e]/50" 
                      : "bg-zinc-800/50 border-transparent hover:border-white/10"
                  )}
                >
                  <div className="w-full h-20 rounded-lg mb-2 bg-gradient-to-br from-purple-900 to-pink-900" />
                  <p className="text-xs font-bold">Neon</p>
                </button>
              </div>
            </div>

            {/* Seção Conta */}
            <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-5">
              <h3 className="font-bold mb-4">Conta</h3>
              <div className="space-y-3">
                <button 
                  onClick={() => setShowChangePassword(!showChangePassword)}
                  className="w-full px-4 py-3 rounded-xl bg-zinc-800 text-sm font-bold hover:bg-zinc-700 transition-colors text-left flex items-center justify-between"
                >
                  Alterar Senha
                  {showChangePassword ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showChangePassword && (
                  <div className="space-y-3 pt-3 border-t border-white/5">
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Senha Atual</label>
                      <input 
                        type="password" 
                        className="w-full px-4 py-3 rounded-xl bg-zinc-800 border border-white/5 text-sm focus:outline-none focus:border-[#22c55e]/50"
                        placeholder="Digite sua senha atual"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Nova Senha</label>
                      <input 
                        type="password" 
                        className="w-full px-4 py-3 rounded-xl bg-zinc-800 border border-white/5 text-sm focus:outline-none focus:border-[#22c55e]/50"
                        placeholder="Digite sua nova senha"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Confirmar Nova Senha</label>
                      <input 
                        type="password" 
                        className="w-full px-4 py-3 rounded-xl bg-zinc-800 border border-white/5 text-sm focus:outline-none focus:border-[#22c55e]/50"
                        placeholder="Confirme sua nova senha"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </div>
                    <button 
                      disabled={changingPassword}
                      onClick={async () => {
                        if (newPassword !== confirmPassword) {
                          alert("As senhas não conferem!");
                          return;
                        }
                        if (!newPassword) {
                          alert("Digite uma nova senha!");
                          return;
                        }
                        
                        setChangingPassword(true);
                        
                        try {
                          // Update password in Supabase Auth
                          const { error } = await supabase.auth.updateUser({
                            password: newPassword
                          });
                          
                          if (error) throw error;
                          
                          alert("Senha alterada com sucesso!");
                          setCurrentPassword("");
                          setNewPassword("");
                          setConfirmPassword("");
                          setShowChangePassword(false);
                        } catch (err) {
                          console.error('Erro ao alterar senha:', err);
                          alert("Erro ao alterar senha! Verifique a senha atual e tente novamente.");
                        } finally {
                          setChangingPassword(false);
                        }
                      }}
                      className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-sm font-bold hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {changingPassword ? "Alterando..." : "Salvar Nova Senha"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'cursos' ? (
          selectedCourse ? (
            <>
              <header className="h-auto min-h-20 border-b border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between px-4 md:px-8 py-4 bg-[#0d0d0d]/30 backdrop-blur-md gap-4">
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleBackToList}
                    className="md:hidden p-2 bg-zinc-800 rounded-full text-white hover:bg-zinc-700 transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <h2 className="text-xl font-bold">Gerenciar Curso: <span className="text-zinc-500">{selectedCourse.name}</span></h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setSelectedCourseForModule(selectedCourse?.id || null);
                      setShowAddModuleModal(true);
                    }}
                    className="px-4 md:px-6 py-2 md:py-3 rounded-xl bg-zinc-800 text-white font-bold text-sm hover:bg-zinc-700 transition-colors flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar Módulo
                  </button>
                  <button 
                    onClick={() => setShowUploadModal(true)}
                    className="px-4 md:px-6 py-2 md:py-3 rounded-xl bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-white font-bold text-sm shadow-lg shadow-green-500/10 active:scale-[0.98] transition-all flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4 md:w-5 md:h-5" />
                    Upload de Novo Vídeo
                  </button>
                </div>
              </header>
              
              <div className="flex-1 overflow-y-auto p-4 md:p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
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
            <header className="h-auto min-h-20 border-b border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between px-4 md:px-8 py-4 bg-[#0d0d0d]/30 backdrop-blur-md gap-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between w-full gap-4">
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleBackToList}
                    className="md:hidden p-2 bg-zinc-800 rounded-full text-white hover:bg-zinc-700 transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <h2 className="text-xl font-bold">Alunos <span className="text-zinc-500">({selectedStudent.instrument})</span></h2>
                  <div className="flex flex-wrap gap-3">
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
                    "px-3 md:px-4 py-2 rounded-lg text-xs font-bold transition-all",
                    viewMode === 'chat' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-white"
                  )}
                >
                  Chat
                </button>
                <button 
                  onClick={() => setViewMode('lessons')}
                  className={cn(
                    "px-3 md:px-4 py-2 rounded-lg text-xs font-bold transition-all",
                    viewMode === 'lessons' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-white"
                  )}
                >
                  Gerenciar Aulas
                </button>
              </div>
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
                  
                  <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6">
                    {messages.map((msg) => {
                      console.log('Renderizando mensagem:', msg);
                      const isMe = msg.sender_id === teacherId;
                      const mediaUrl = (msg as any).media_url || msg.content;
                      return (
                        <div key={msg.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                          <div className={cn(
                            "max-w-[85%] md:max-w-[70%] px-4 py-3 rounded-2xl relative",
                            isMe 
                              ? "bg-zinc-700 text-white rounded-tr-none" 
                              : "bg-zinc-800 border border-zinc-700 text-white rounded-tl-none"
                          )}>
                            {msg.type === 'video' && (
                              <div className="flex flex-col gap-2 min-w-[14rem] mb-2">
                                <video 
                                  src={mediaUrl} 
                                  controls 
                                  className="w-full rounded-xl bg-black/20"
                                  poster={msg.thumbnail_url || undefined}
                                />
                                {msg.file_name && (
                                  <span className="text-[0.75rem] font-bold opacity-90 truncate">{msg.file_name}</span>
                                )}
                              </div>
                            )}
                            {msg.type === 'audio' && (
                              <div className="flex flex-col gap-2 min-w-[14rem] mb-2">
                                <audio 
                                  src={mediaUrl} 
                                  controls 
                                  className="w-full"
                                />
                                {msg.file_name && (
                                  <span className="text-[0.75rem] font-bold opacity-90 truncate">{msg.file_name}</span>
                                )}
                              </div>
                            )}
                            {msg.type === 'text' && (
                              <p className="text-sm leading-relaxed">{msg.content}</p>
                            )}
                            <span className="text-[0.625rem] opacity-50 mt-1 block text-right">
                              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Input Bar */}
                  <div className="p-4 md:p-6 bg-gradient-to-t from-black to-transparent relative">
                    <div className="relative max-w-4xl mx-auto">
                      <div className="relative flex items-center gap-2 bg-zinc-900/90 backdrop-blur-xl p-2 rounded-2xl border border-white/10 shadow-2xl">
                        {/* Hidden file input */}
                        <input 
                          type="file" 
                          id="file-upload" 
                          className="hidden" 
                          onChange={handleFileSelect}
                          accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
                        />
                        
                        <button 
                          onClick={() => document.getElementById('file-upload')?.click()}
                          className="p-2 md:p-3 text-zinc-400 hover:text-white transition-colors"
                        >
                          <Paperclip className="w-4 h-4 md:w-5 md:h-5" />
                        </button>
                        
                        <input 
                          type="text"
                          placeholder="Digite sua mensagem..."
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                          className="flex-1 bg-transparent border-none focus:ring-0 text-sm placeholder:text-zinc-600"
                        />
                        
                        <button 
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                          className="p-2 md:p-3 text-zinc-400 hover:text-white transition-colors relative"
                        >
                          <Smile className="w-4 h-4 md:w-5 md:h-5" />
                        </button>
                        
                        {chatInput.trim() ? (
                          <button 
                            onClick={handleSendMessage}
                            className="w-10 h-10 md:w-11 md:h-11 bg-zinc-700 hover:bg-zinc-600 rounded-xl flex items-center justify-center shadow-lg active:scale-95 transition-all"
                          >
                            <Send className="w-4 h-4 md:w-5 md:h-5 text-white" />
                          </button>
                        ) : (
                          <button 
                            onClick={isRecording ? stopRecording : startRecording}
                            className={`w-10 h-10 md:w-11 md:h-11 rounded-xl flex items-center justify-center shadow-lg active:scale-95 transition-all ${
                              isRecording 
                                ? 'bg-red-500 animate-pulse' 
                                : 'bg-zinc-700 hover:bg-zinc-600'
                            }`}
                          >
                            <Mic className="w-4 h-4 md:w-5 md:h-5 text-white" />
                          </button>
                        )}
                      </div>
                      
                      {/* Emoji Picker */}
                      {showEmojiPicker && (
                        <div className="absolute bottom-full mb-4 left-0 right-0 bg-zinc-900 border border-white/10 rounded-xl p-3 shadow-xl max-h-48 overflow-y-auto">
                          <div className="grid grid-cols-8 gap-2">
                            {['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖'].map((emoji, index) => (
                              <button
                                key={index}
                                onClick={() => {
                                  setChatInput(prev => prev + emoji);
                                  setShowEmojiPicker(false);
                                }}
                                className="text-2xl hover:bg-zinc-800 rounded-lg p-1 transition-colors"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Lessons Management View */}
              {viewMode === 'lessons' && (
                <div className="flex-1 flex flex-col bg-[#050505]">
                  <div className="p-4 md:p-6 border-b border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-[#0d0d0d]/20">
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

                  <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4 md:space-y-6">
                    {modules.map((module) => (
                      <div key={module.id} className="rounded-2xl border border-white/5 bg-zinc-900/20 overflow-hidden">
                        <button 
                          onClick={() => setOpenModules(prev => prev.includes(module.id) ? prev.filter(id => id !== module.id) : [...prev, module.id])}
                          className="w-full p-4 md:p-5 flex items-center justify-between hover:bg-white/5 transition-colors"
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
                          <div className="px-4 md:px-5 pb-4 md:pb-5 grid grid-cols-1 gap-3">
                            {(module.lessons || []).map((lesson) => (
                              <div key={lesson.id} className={cn(
                                "flex flex-col md:flex-row items-start md:items-center justify-between p-4 rounded-xl border transition-all gap-4",
                                lesson.is_locked ? "bg-black/40 border-white/5" : "bg-[#22c55e]/5 border-[#22c55e]/20"
                              )}>
                                <div className="flex items-center gap-4">
                                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-lg bg-black/40 flex items-center justify-center overflow-hidden relative">
                                    <Video className="w-4 h-4 md:w-5 md:h-5 text-zinc-600" />
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

      {/* Modal de Cadastro */}
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
                  {courses.map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
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

      {/* Modal de Adicionar Curso */}
      {showAddCourseModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-zinc-900 rounded-[2.5rem] border border-white/5 p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-2xl font-bold text-white">Novo Curso</h2>
                <p className="text-zinc-500 text-sm">Adicione um novo instrumento/curso.</p>
              </div>
              <button onClick={() => setShowAddCourseModal(false)} className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                <X size={20}/>
              </button>
            </div>

            <form onSubmit={handleAddCourse} className="flex flex-col gap-4">
              <div className="space-y-1">
                <label className="text-[0.625rem] font-bold text-zinc-500 uppercase ml-4">Nome do Curso</label>
                <input 
                  placeholder="Ex: Violão Clássico" 
                  value={courseName}
                  onChange={e => setCourseName(e.target.value)}
                  required
                  className="w-full h-14 bg-zinc-800/50 border border-white/5 px-6 rounded-2xl text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-14 rounded-2xl font-bold text-white transition-all active:scale-[0.98] mt-4 flex items-center justify-center bg-gradient-to-r from-[#22c55e] to-[#16a34a] shadow-lg shadow-green-500/10"
              >
                {loading ? <Loader2 className="animate-spin" size={20} /> : "ADICIONAR CURSO"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Editar Curso */}
      {showEditCourseModal && editingCourse && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-zinc-900 rounded-[2.5rem] border border-white/5 p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-2xl font-bold text-white">Editar Curso</h2>
                <p className="text-zinc-500 text-sm">Altere o nome do curso e gerencie módulos.</p>
              </div>
              <button onClick={() => { setShowEditCourseModal(false); setEditingCourse(null); }} className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                <X size={20}/>
              </button>
            </div>

            <form onSubmit={handleEditCourse} className="flex flex-col gap-4">
              <div className="space-y-1">
                <label className="text-[0.625rem] font-bold text-zinc-500 uppercase ml-4">Nome do Curso</label>
                <input 
                  placeholder="Ex: Violão Clássico" 
                  value={courseName}
                  onChange={e => setCourseName(e.target.value)}
                  required
                  className="w-full h-14 bg-zinc-800/50 border border-white/5 px-6 rounded-2xl text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors"
                />
              </div>

              <div className="border-t border-white/5 pt-6 mt-2">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white">Módulos</h3>
                  <button
                    onClick={(e) => { 
                      e.preventDefault(); 
                      setSelectedCourseForModule(editingCourse?.id || null);
                      setShowAddModuleModal(true); 
                    }}
                    className="flex items-center gap-2 text-[#22c55e] text-sm font-bold hover:text-[#16a34a] transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar Módulo
                  </button>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {courseModules.map(module => (
                    <div key={module.id} className="flex items-center justify-between p-3 rounded-xl bg-zinc-800/50 border border-white/5">
                      <span className="text-sm text-white">{module.title}</span>
                      <button
                        className="p-2 text-zinc-500 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-14 rounded-2xl font-bold text-white transition-all active:scale-[0.98] mt-4 flex items-center justify-center bg-gradient-to-r from-[#22c55e] to-[#16a34a] shadow-lg shadow-green-500/10"
              >
                {loading ? <Loader2 className="animate-spin" size={20} /> : "SALVAR ALTERAÇÕES"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Adicionar Módulo */}
      {showAddModuleModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-zinc-900 rounded-[2.5rem] border border-white/5 p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-2xl font-bold text-white">Novo Módulo</h2>
                <p className="text-zinc-500 text-sm">Adicione um novo módulo ao curso.</p>
              </div>
              <button onClick={() => setShowAddModuleModal(false)} className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                <X size={20}/>
              </button>
            </div>

            <form onSubmit={handleAddModule} className="flex flex-col gap-4">
              <div className="space-y-1">
                <label className="text-[0.625rem] font-bold text-zinc-500 uppercase ml-4">Curso</label>
                <select 
                  value={selectedCourseForModule || ""}
                  onChange={e => setSelectedCourseForModule(e.target.value)}
                  required
                  className="w-full h-14 bg-zinc-800/50 border border-white/5 px-6 rounded-2xl text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors appearance-none"
                >
                  <option value="">Selecione um curso</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>{course.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[0.625rem] font-bold text-zinc-500 uppercase ml-4">Título do Módulo</label>
                <input 
                  placeholder="Ex: Módulo 1 - Fundamentos" 
                  value={moduleTitle}
                  onChange={e => setModuleTitle(e.target.value)}
                  required
                  className="w-full h-14 bg-zinc-800/50 border border-white/5 px-6 rounded-2xl text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors"
                />
              </div>
              
              <div className="space-y-1">
                <label className="text-[0.625rem] font-bold text-zinc-500 uppercase ml-4">Descrição (opcional)</label>
                <textarea 
                  placeholder="Breve descrição do módulo..." 
                  value={moduleDescription}
                  onChange={e => setModuleDescription(e.target.value)}
                  rows={3}
                  className="w-full bg-zinc-800/50 border border-white/5 px-6 py-4 rounded-2xl text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-14 rounded-2xl font-bold text-white transition-all active:scale-[0.98] mt-4 flex items-center justify-center bg-gradient-to-r from-[#22c55e] to-[#16a34a] shadow-lg shadow-green-500/10"
              >
                {loading ? <Loader2 className="animate-spin" size={20} /> : "ADICIONAR MÓDULO"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Upload de Vídeo */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-zinc-900 rounded-[2.5rem] border border-white/5 p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-2xl font-bold text-white">Novo Vídeo de Aula</h2>
                <p className="text-zinc-500 text-sm">Preencha os dados e envie o vídeo.</p>
              </div>
              <button onClick={() => setShowUploadModal(false)} className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                <X size={20}/>
              </button>
            </div>

            <form onSubmit={handleUploadVideo} className="flex flex-col gap-4">
              <div className="space-y-1">
                <label className="text-[0.625rem] font-bold text-zinc-500 uppercase ml-4">Título do Vídeo</label>
                <input 
                  placeholder="Ex: Postura Correta para Tocar" 
                  value={videoTitle}
                  onChange={e => setVideoTitle(e.target.value)}
                  required
                  className="w-full h-14 bg-zinc-800/50 border border-white/5 px-6 rounded-2xl text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors"
                />
              </div>
              
              <div className="space-y-1">
                <label className="text-[0.625rem] font-bold text-zinc-500 uppercase ml-4">Descrição (opcional)</label>
                <textarea 
                  placeholder="Breve descrição do vídeo..." 
                  value={videoDescription}
                  onChange={e => setVideoDescription(e.target.value)}
                  rows={3}
                  className="w-full bg-zinc-800/50 border border-white/5 px-6 py-4 rounded-2xl text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors resize-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[0.625rem] font-bold text-zinc-500 uppercase ml-4">Módulo</label>
                <select 
                  value={selectedModule}
                  onChange={e => setSelectedModule(e.target.value)}
                  required
                  className="w-full h-14 bg-zinc-800/50 border border-white/5 px-6 rounded-2xl text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors appearance-none"
                >
                  <option value="">Selecione um módulo</option>
                  {courseModules.map((module) => (
                    <option key={module.id} value={module.id}>{module.title}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[0.625rem] font-bold text-zinc-500 uppercase ml-4">Arquivo de Vídeo</label>
                <div className="relative">
                  <input 
                    type="file"
                    accept="video/*"
                    onChange={e => setSelectedVideoFile(e.target.files ? e.target.files[0] : null)}
                    required
                    className="w-full h-14 bg-zinc-800/50 border border-white/5 px-6 rounded-2xl text-sm focus:outline-none focus:border-[#22c55e]/30 transition-colors file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-[#22c55e] file:text-black hover:file:bg-[#16a34a]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={uploading || !selectedVideoFile || !selectedModule}
                className="w-full h-14 rounded-2xl font-bold text-white transition-all active:scale-[0.98] mt-4 flex items-center justify-center bg-gradient-to-r from-[#22c55e] to-[#16a34a] shadow-lg shadow-green-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? <Loader2 className="animate-spin" size={20} /> : "ENVIAR VÍDEO"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
