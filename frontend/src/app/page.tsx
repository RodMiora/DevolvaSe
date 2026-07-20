"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import MobileLayout from "@/components/MobileLayout";
import ChatScreen from "@/components/ChatScreen";
import LessonsScreen from "@/components/LessonsScreen";
import EnvioScreen from "@/components/EnvioScreen";
import LoginScreen from "@/components/LoginScreen";
import TeacherDashboard from "@/components/TeacherDashboard";

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async (userId: string) => {
      console.log("🔍 Iniciando busca de perfil para:", userId);
      
      const { data, error, status } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (error) {
        console.error("❌ Erro detalhado ao buscar perfil:", {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
          status: status
        });
        
        if (error.code === '42501') {
          console.warn("💡 Dica: O erro 42501 indica que o RLS está bloqueando o acesso. Verifique as policies no Supabase.");
        } else if (error.code === 'PGRST116') {
          console.warn("💡 Dica: Perfil não encontrado. Verifique se existe uma linha na tabela 'profiles' com este ID.");
        }
      } else {
        console.log("✅ Perfil recuperado com sucesso:", data);
        console.log("👤 Role do usuário:", data?.role);
      }
      
      setProfile(data);
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-[#0A0A0A] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#00C853] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  // Caso o perfil não seja encontrado ou haja erro de permissão
  if (!profile && !loading) {
    return (
      <div className="fixed inset-0 bg-[#0A0A0A] flex flex-col items-center justify-center p-6 text-center">
        <div className="text-red-500 mb-4">⚠️</div>
        <h2 className="text-white text-xl font-bold mb-2">Erro de Perfil</h2>
        <p className="text-[#888888] mb-6 max-w-md">
          Não conseguimos carregar suas permissões. Verifique se seu usuário existe na tabela 'profiles' ou se o RLS está bloqueando o acesso.
        </p>
        <button 
          onClick={() => supabase.auth.signOut()}
          className="px-6 py-2 bg-[#1A1A1A] text-white rounded-lg border border-white/10"
        >
          Sair e tentar novamente
        </button>
      </div>
    );
  }

  console.log("Current session user ID:", session.user.id);
  console.log("Current profile role for rendering:", profile?.role);

  // Redirecionamento baseado no role
  if (profile?.role === 'teacher') {
    console.log("Rendering TeacherDashboard...");
    return <TeacherDashboard />;
  }

  console.log("Rendering Student MobileLayout...");

  const user = session.user;
  const mockUser = { 
    id: user.id, 
    name: profile?.full_name || user.email?.split('@')[0], 
    role: profile?.role || "student", 
    instrument: profile?.instrument || "Guitarra" 
  };
  
  const MOCK_TEACHER_ID = "teacher_123";
  const MOCK_LESSONS = [
    { id: "l1", title: "Acordes Básicos", is_locked: false, is_completed: true, video_url: "https://example.com/video1.mp4" },
    { id: "l2", title: "Escala Pentatônica", is_locked: false, is_completed: false, video_url: "https://example.com/video2.mp4" },
    { id: "l3", title: "Riffs Famosos", is_locked: true, is_completed: false },
    { id: "l4", title: "Teoria Musical", is_locked: true, is_completed: false },
  ];

  return (
    <main className="h-full">
      <MobileLayout
        hasChatNotification={true}
        onLogout={() => supabase.auth.signOut()}
        chat={<ChatScreen userId={mockUser.id} receiverId={MOCK_TEACHER_ID} />}
        aulas={
          <div className="relative h-full">
            <LessonsScreen 
              studentName={mockUser.name} 
              instrument={mockUser.instrument} 
            />
          </div>
        }
        envio={<EnvioScreen studentId={mockUser.id} lessonId="l2" />}
      />
    </main>
  );
}
