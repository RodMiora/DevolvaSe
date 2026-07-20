import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Send, Paperclip, Mic, Play, Smile, CheckCheck } from 'lucide-react';
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  type: 'text' | 'audio' | 'video';
  file_name?: string;
  thumbnail_url?: string;
  exercise_id?: string;
}

export default function ChatScreen({ userId, receiverId }: { userId: string, receiverId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .or(`sender_id.eq."${userId}",receiver_id.eq."${userId}"`)
        .order('created_at', { ascending: true });
      if (data) setMessages(data);
    };

    fetchMessages();

    const channel = supabase
      .channel('chat_messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, 
        payload => setMessages(prev => [...prev, payload.new as Message]))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, receiverId]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-black w-full overflow-hidden">
      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-8 w-full">
        {messages.map((msg) => {
          const isMe = msg.sender_id === userId;
          return (
            <div key={msg.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
              <div className={cn(
                "max-w-[85%] px-4 py-3 rounded-[1.25rem] relative shadow-lg",
                isMe 
                  ? "bg-zinc-900 border border-[#f97316]/30 text-white rounded-tr-none shadow-[0_0_15px_rgba(249,115,22,0.1)]" 
                  : "bg-gradient-to-r from-[#22c55e] to-[#f97316] text-white rounded-tl-none"
              )}>
                {/* Text Content */}
                {msg.type === 'text' && (
                  <p className="text-[0.9375rem] leading-snug font-medium pr-8">{msg.content}</p>
                )}
                
                {/* Video Content */}
                {msg.type === 'video' && (
                  <div className="flex flex-col gap-2 min-w-[14rem]">
                    <div className="relative aspect-video rounded-xl overflow-hidden bg-black/20 group">
                      <img 
                        src={msg.thumbnail_url || "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400"} 
                        alt="Video Thumbnail"
                        className="w-full h-full object-cover opacity-80"
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border border-white/40 group-hover:scale-110 transition-transform">
                          <Play className="w-5 h-5 text-white fill-white" />
                        </div>
                      </div>
                    </div>
                    <span className="text-[0.75rem] font-bold opacity-90 truncate">{msg.file_name || "Meu treino.mp4"}</span>
                  </div>
                )}

                {/* Audio Content */}
                {msg.type === 'audio' && (
                  <div className="flex flex-col gap-2 min-w-[14rem]">
                    <div className="flex items-center gap-3">
                      <button className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border border-white/40 flex-shrink-0">
                        <Play className="w-5 h-5 text-white fill-white" />
                      </button>
                      <div className="flex-1 flex items-center gap-[2px] h-8">
                        {[0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 0.4, 0.6, 0.9, 0.5, 0.7, 0.4, 0.6, 0.8, 0.5, 0.7, 0.4].map((h, i) => (
                          <div 
                            key={i} 
                            className="flex-1 bg-white/40 rounded-full" 
                            style={{ height: `${h * 100}%` }}
                          />
                        ))}
                      </div>
                    </div>
                    <span className="text-[0.75rem] font-bold opacity-90 truncate">{msg.file_name || "Audio Feedback.mp3"}</span>
                  </div>
                )}

                {/* Time & Status */}
                <div className="flex items-center justify-end gap-1 mt-1">
                  <span className={cn("text-[0.625rem] opacity-70", isMe ? "text-zinc-500" : "text-white/80")}>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isMe && <CheckCheck className="w-3.5 h-3.5 text-[#22c55e]" />}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input Area */}
      <div className="px-4 pb-8 pt-2 bg-black w-full">
        <div className="flex items-center gap-3">
          {/* Clip Icon */}
          <button className="p-2 text-zinc-400 hover:text-white transition-colors flex-shrink-0">
            <Paperclip className="w-6 h-6" />
          </button>

          {/* Main Input Field */}
          <div className="flex-1 flex items-center gap-2 bg-zinc-900 border border-white/5 rounded-full px-4 py-2.5 shadow-inner group focus-within:border-[#22c55e]/50 transition-all">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Digite sua mensagem..."
              className="flex-1 bg-transparent border-none focus:ring-0 text-[0.9375rem] text-white placeholder-zinc-500 min-w-0"
            />
            <button className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors">
              <Smile className="w-6 h-6" />
            </button>
          </div>

          {/* Action Button (Mic or Send) */}
          <div className="flex-shrink-0">
            {newMessage.trim() ? (
              <button className="w-12 h-12 bg-gradient-to-r from-[#f97316] to-[#ef4444] rounded-full flex items-center justify-center text-white shadow-lg shadow-orange-500/20 active:scale-90 transition-transform">
                <Send className="w-6 h-6" />
              </button>
            ) : (
              <button className="w-12 h-12 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                <Mic className="w-6 h-6" />
              </button>
            )}
          </div>
        </div>
        
        {/* Glow Line below input like in mockup */}
        <div className="mt-4 h-[2px] w-full bg-gradient-to-r from-[#22c55e]/0 via-[#f97316]/40 to-[#ef4444]/0 rounded-full blur-sm" />
      </div>
    </div>
  );
}