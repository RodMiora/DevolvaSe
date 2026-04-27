"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import Logo from "./Logo";
import { Loader2, Eye, EyeOff } from "lucide-react";

export default function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Gerar email interno a partir do username
    const internalEmail = `${username.trim().toLowerCase()}@devolvase.app`;

    const { error } = await supabase.auth.signInWithPassword({
      email: internalEmail,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#0A0A0A] flex flex-col items-center justify-center px-[20px] z-50">
      <div className="w-full max-w-[400px] flex flex-col items-center gap-12">
        {/* Logo Section */}
        <Logo className="w-full" />

        <div className="w-full flex flex-col gap-8">
          <form onSubmit={handleLogin} className="w-full flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <input
                type="text"
                placeholder="Seu Nome"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full h-[52px] px-4 rounded-xl text-sm"
              />
            </div>
            <div className="flex flex-col gap-2 relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Sua Senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full h-[52px] px-4 pr-12 rounded-xl text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#888888] hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>

            {error && (
              <p className="text-red-500 text-xs text-center font-medium px-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-[52px] rounded-xl font-bold text-white transition-all active:scale-[0.98] mt-4 flex items-center justify-center"
              style={{
                background: "var(--vu-gradient)",
              }}
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : "TOCAR"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
