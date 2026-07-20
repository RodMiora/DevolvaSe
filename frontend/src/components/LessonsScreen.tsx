import React from "react";
import { Play, CheckCircle2, Lock, MessageSquare, Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface Lesson {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  duration: string;
  status: "completed" | "in-progress" | "locked";
}

export default function LessonsScreen({
  studentName,
  instrument,
  lessons,
}: {
  studentName: string;
  instrument: string;
  lessons: Lesson[];
}) {
  return (
    <div className="flex flex-col h-full bg-black relative w-full overflow-hidden">
      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-32 w-full">
        <h2 className="text-[1.5rem] font-bold text-white mb-6">Vídeos</h2>

        {/* Featured Video Player (Top) */}
        <div className="relative aspect-video rounded-2xl overflow-hidden mb-8 group cursor-pointer shadow-[0_0_20px_rgba(34,197,94,0.2)]">
          <img
            src="https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=800&auto=format&fit=crop&q=60"
            alt="Featured Lesson"
            className="w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-500"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20 group-hover:scale-110 transition-transform">
              <Play className="w-8 h-8 text-white fill-white" />
            </div>
          </div>
          {/* VU Glow Border */}
          <div className="absolute inset-0 rounded-2xl border-2 border-transparent bg-gradient-to-r from-[#22c55e] via-[#eab308] to-[#ef4444] [mask-image:linear-gradient(white,white)_padding-box,linear-gradient(white,white)] opacity-30" />
        </div>

        {/* Lessons Timeline */}
        <div className="space-y-4">
          {lessons.map((lesson) => (
            <div
              key={lesson.id}
              className={cn(
                "relative flex items-center gap-3 p-3 rounded-xl border transition-all w-full",
                lesson.status === "completed" && "bg-zinc-900/50 border-white/5",
                lesson.status === "in-progress" && "bg-zinc-900 border-[#f97316] shadow-[0_0_20px_rgba(249,115,22,0.2)] scale-[1.02] z-10",
                lesson.status === "locked" && "bg-black border-white/5 opacity-40 pointer-events-none"
              )}
            >
              {/* Thumbnail */}
              <div className="relative w-24 h-16 rounded-lg overflow-hidden flex-shrink-0">
                <img src={lesson.thumbnail} alt={lesson.title} className="w-full h-full object-cover" />
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
                {lesson.status === "in-progress" && (
                  <span className="text-[0.625rem] font-bold text-[#f97316] uppercase mt-1 block">
                    Em Progresso
                  </span>
                )}
              </div>

              {/* Status Icon */}
              <div className="flex-shrink-0">
                {lesson.status === "completed" && (
                  <CheckCircle2 className="w-6 h-6 text-[#22c55e] fill-[#22c55e]/10" />
                )}
                {lesson.status === "in-progress" && (
                  <div className="w-6 h-6 rounded-full border-2 border-[#f97316] flex items-center justify-center shadow-[0_0_10px_rgba(249,115,22,0.5)]">
                    <div className="w-2 h-2 bg-[#f97316] rounded-full animate-pulse" />
                  </div>
                )}
                {lesson.status === "locked" && (
                  <Lock className="w-5 h-5 text-zinc-600" />
                )}
              </div>
            </div>
          ))}

          {/* Locked Module Example */}
          <div className="mt-6 flex items-center justify-center gap-3 p-4 rounded-xl bg-zinc-900/30 border border-white/5 opacity-40">
            <Lock className="w-5 h-5 text-zinc-500" />
            <span className="font-bold text-zinc-500">Módulo 2 (Bloqueado)</span>
          </div>
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