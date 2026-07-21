import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Send, Paperclip, Mic, Play, Smile, CheckCheck } from 'lucide-react';
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
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
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    // Validate that sender_id is valid
    if (!userId) {
      alert("IDs de usuário inválidos!");
      return;
    }

    try {
      // Create a temporary local message for optimistic update
      const tempId = `temp_${Date.now()}`;
      const tempMessage = {
        id: tempId,
        sender_id: userId,
        receiver_id: '54268554-9b11-4986-9c02-c1637b0863fc',
        content: newMessage.trim(),
        type: 'text' as const,
        created_at: new Date().toISOString()
      } as any;

      // Optimistic update: add to local state immediately
      setMessages(prev => [...prev, tempMessage]);
      
      // Clear input right away
      const inputValue = newMessage;
      setNewMessage('');

      const messageData = {
        sender_id: userId,
        receiver_id: '54268554-9b11-4986-9c02-c1637b0863fc',
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
    if (!file) return;

    const formData = new FormData();
    formData.append('sender_id', userId);
    formData.append('receiver_id', '54268554-9b11-4986-9c02-c1637b0863fc');
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
        sender_id: userId,
        receiver_id: '54268554-9b11-4986-9c02-c1637b0863fc',
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
    const formData = new FormData();
    formData.append('sender_id', userId);
    formData.append('receiver_id', '54268554-9b11-4986-9c02-c1637b0863fc');
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
        sender_id: userId,
        receiver_id: '54268554-9b11-4986-9c02-c1637b0863fc',
        content: result.audio_url,
        type: 'audio',
        file_name: 'Áudio gravado',
        media_url: result.audio_url
      });
    } catch (err) {
      console.error('Erro ao enviar áudio:', err);
    }
  };

  useEffect(() => {
    const fetchMessages = async () => { 
      if (!userId || !receiverId) return; 
 
      // Busca mensagens onde o usuário logado é o remetente OU o destinatário 
      const { data, error } = await supabase 
        .from('chat_messages') 
        .select('*') 
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`) 
        .order('created_at', { ascending: true }); 
 
      if (error) { 
        console.error('Erro ao buscar mensagens do aluno:', error); 
      } else if (data) { 
        setMessages(data); 
      } 
    };

    fetchMessages();

    const channel = supabase
      .channel(`chat:${userId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'chat_messages'
      }, payload => {
        const newMsg = payload.new as Message;
        // Only add message if it's part of the conversation between user and receiver
        if (
          (newMsg.sender_id === userId && newMsg.receiver_id === receiverId) ||
          (newMsg.sender_id === receiverId && newMsg.receiver_id === userId)
        ) {
          setMessages(prev => [...prev, newMsg]);
        }
      })
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
          const mediaUrl = (msg as any).media_url || msg.content;
          return (
            <div key={msg.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
              <div className={cn(
                "max-w-[85%] px-4 py-3 rounded-[1.25rem] relative",
                isMe 
                  ? "bg-zinc-700 text-white rounded-tr-none" 
                  : "bg-zinc-800 border border-zinc-700 text-white rounded-tl-none"
              )}>
                {/* Text Content */}
                {msg.type === 'text' && (
                  <p className="text-[0.9375rem] leading-snug font-medium pr-8">{msg.content}</p>
                )}
                
                {/* Video Content */}
                {msg.type === 'video' && (
                  <div className="flex flex-col gap-2 min-w-[14rem]">
                    <video 
                      src={mediaUrl} 
                      controls 
                      className="w-full rounded-xl bg-black/20"
                      poster={msg.thumbnail_url || undefined}
                    />
                    <span className="text-[0.75rem] font-bold opacity-90 truncate">{msg.file_name || "Meu treino.mp4"}</span>
                  </div>
                )}

                {/* Audio Content */}
                {msg.type === 'audio' && (
                  <div className="flex flex-col gap-2 min-w-[14rem]">
                    <audio 
                      src={mediaUrl} 
                      controls 
                      className="w-full"
                    />
                    <span className="text-[0.75rem] font-bold opacity-90 truncate">{msg.file_name || "Audio Feedback.mp3"}</span>
                  </div>
                )}

                {/* Time & Status */}
                <div className="flex items-center justify-end gap-1 mt-1">
                  <span className={cn("text-[0.625rem] opacity-70", isMe ? "text-zinc-400" : "text-zinc-400")}>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isMe && <CheckCheck className="w-3.5 h-3.5 text-zinc-400" />}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input Area */}
      <div className="px-4 pb-8 pt-2 bg-black w-full relative">
        <div className="flex items-center gap-3">
          {/* Hidden file input */}
          <input 
            type="file" 
            id="chat-file-upload" 
            className="hidden" 
            onChange={handleFileSelect}
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
          />
          
          {/* Clip Icon */}
          <button 
            onClick={() => document.getElementById('chat-file-upload')?.click()}
            className="p-2 text-zinc-400 hover:text-white transition-colors flex-shrink-0"
          >
            <Paperclip className="w-6 h-6" />
          </button>

          {/* Main Input Field */}
          <div className="flex-1 flex items-center gap-2 bg-zinc-900 border border-white/5 rounded-full px-4 py-2.5 shadow-inner group focus-within:border-[#22c55e]/50 transition-all">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Digite sua mensagem..."
              className="flex-1 bg-transparent border-none focus:ring-0 text-[0.9375rem] text-white placeholder-zinc-500 min-w-0"
            />
            <button 
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <Smile className="w-6 h-6" />
            </button>
          </div>

          {/* Action Button (Mic or Send) */}
          <div className="flex-shrink-0">
            {newMessage.trim() ? (
              <button 
                onClick={handleSendMessage}
                className="w-12 h-12 bg-gradient-to-r from-[#f97316] to-[#ef4444] rounded-full flex items-center justify-center text-white shadow-lg shadow-orange-500/20 active:scale-90 transition-transform"
              >
                <Send className="w-6 h-6" />
              </button>
            ) : (
              <button 
                onClick={isRecording ? stopRecording : startRecording}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                  isRecording 
                    ? 'bg-red-500 animate-pulse' 
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Mic className="w-6 h-6" />
              </button>
            )}
          </div>
        </div>
        
        {/* Emoji Picker */}
        {showEmojiPicker && (
          <div className="absolute bottom-full mb-4 left-4 right-4 bg-zinc-900 border border-white/10 rounded-xl p-3 shadow-xl max-h-48 overflow-y-auto">
            <div className="grid grid-cols-8 gap-2">
              {['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖'].map((emoji, index) => (
                <button
                  key={index}
                  onClick={() => {
                    setNewMessage(prev => prev + emoji);
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
        
        {/* Glow Line below input like in mockup */}
        <div className="mt-4 h-[2px] w-full bg-gradient-to-r from-[#22c55e]/0 via-[#f97316]/40 to-[#ef4444]/0 rounded-full blur-sm" />
      </div>
    </div>
  );
}