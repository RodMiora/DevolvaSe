import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiAlert } from "@/lib/api";

export type NotificationRow = {
  id: string;
  user_id: string;
  type?: string;
  title?: string;
  message?: string;
  action_url?: string | null;
  is_read?: boolean;
  read_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export default function NotificationBell({
  userId,
  variant = "student",
  pollingIntervalMs = 30000,
}: {
  userId: string | null | undefined;
  variant?: "student" | "teacher";
  pollingIntervalMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const loadNotifications = useCallback(
    async (includeRead = true) => {
      if (!userId) return;
      setLoading(true);
      try {
        const limit = includeRead ? 50 : 20;
        const res = await apiFetch(
          `/notifications/${userId}?limit=${limit}${includeRead ? "" : "&only_unread=true"}`,
          { method: "GET" },
          { throwOnError: false, prefix: "Erro ao carregar notificações" }
        );
        if (res && res.ok) {
          const data = await res.json().catch(() => ({} as any));
          const arr = Array.isArray(data?.notifications) ? data.notifications : [];
          setNotifications(arr as NotificationRow[]);
          const count =
            typeof data?.unread_count === "number"
              ? data.unread_count
              : arr.filter((n: NotificationRow) => !n?.is_read).length;
          setUnreadCount(count);
        }
      } catch (e) {
        // Silencioso: não quebra UI por fallback
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  const loadUnreadCountOnly = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await apiFetch(
        `/notifications/${userId}/unread-count`,
        { method: "GET" },
        { throwOnError: false }
      );
      if (res && res.ok) {
        const data = await res.json().catch(() => ({} as any));
        setUnreadCount(typeof data?.unread_count === "number" ? data.unread_count : 0);
      }
    } catch {
      // Silencioso
    }
  }, [userId]);

  const markAsRead = useCallback(
    async (notif: NotificationRow) => {
      if (!userId || !notif?.id || !!notif.is_read) return;
      // Otimista
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n))
      );
      if (unreadCount > 0) setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await apiFetch(
          `/notifications/${userId}/mark-read`,
          {
            method: "PATCH",
            body: { notification_id: notif.id },
          },
          { throwOnError: false }
        );
      } catch (e) {
        // Silencioso
      }
    },
    [userId, unreadCount]
  );

  const markAllAsRead = useCallback(async () => {
    if (!userId || unreadCount <= 0) return;
    setMarkingAll(true);
    try {
      const res = await apiFetch(
        `/notifications/${userId}/mark-all-read`,
        { method: "PATCH" },
        { throwOnError: false }
      );
      if (res && res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
        setUnreadCount(0);
      }
    } catch (e) {
      apiAlert("Erro ao marcar tudo como lido", e);
    } finally {
      setMarkingAll(false);
    }
  }, [userId, unreadCount]);

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    loadNotifications(true);

    const interval = setInterval(() => {
      // Se dropdown está aberto, atualiza a lista full; senão só count (mais barato)
      if (openRef.current) loadNotifications(true);
      else loadUnreadCountOnly();
    }, Math.max(5000, pollingIntervalMs | 0));

    return () => clearInterval(interval);
  }, [userId, loadNotifications, loadUnreadCountOnly, pollingIntervalMs]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!openRef.current) return;
      if (!containerRef.current) return;
      // No mobile, o overlay já fecha o painel. Não precisamos checar fora.
      if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggleOpen() {
    setOpen((o) => {
      const next = !o;
      if (next && userId) loadNotifications(true);
      return next;
    });
  }

  function relativeTime(ts?: string) {
    if (!ts) return "";
    try {
      const then = new Date(ts).getTime();
      if (isNaN(then)) return "";
      const diff = Date.now() - then;
      const s = Math.max(0, Math.floor(diff / 1000));
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60);
      if (m < 60) return `${m}m`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h`;
      const d = Math.floor(h / 24);
      if (d < 30) return `${d}d`;
      const mo = Math.floor(d / 30);
      if (mo < 12) return `${mo}mes`;
      return `${Math.floor(mo / 12)}a`;
    } catch {
      return "";
    }
  }

  function iconForType(type?: string) {
    switch (type) {
      case "exercise_submitted": return "📤";
      case "exercise_approved": return "🎉";
      case "exercise_feedback": return "💬";
      default: return "🔔";
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-label="Notificações"
        className={cn(
          "relative inline-flex items-center justify-center w-10 h-10 rounded-full text-white/90 transition-all",
          variant === "student"
            ? "hover:bg-white/10 active:bg-white/20"
            : "bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 shadow-sm"
        )}
      >
        <Bell
          className={cn("w-[20px] h-[20px]", unreadCount > 0 && "text-amber-400 animate-[bellwig_2.2s_ease-in-out_infinite]")}
          strokeWidth={2.1}
        />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center bg-[#ef4444] text-white text-[10px] font-bold rounded-full border border-black shadow-[0_0_10px_rgba(239,68,68,0.7)]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Overlay mobile para click-outside sem estourar viewport */}
          <div
            className="fixed inset-0 z-[199] md:hidden bg-black/40 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <style>{`
            @keyframes bellwig {
              0%,100% { transform: rotate(0deg); }
              15% { transform: rotate(-14deg); }
              30% { transform: rotate(10deg); }
              45% { transform: rotate(-8deg); }
              60% { transform: rotate(6deg); }
              75% { transform: rotate(-3deg); }
            }
          `}</style>
          <div
            className={cn(
              // MOBILE: fixed, centralizado, nunca sai da viewport
              // DESKTOP: absolute, ancorado no sino (padrão)
              "z-[200] rounded-2xl border border-white/10 bg-[#0d0d0d] shadow-[0_22px_60px_rgba(0,0,0,0.72)] overflow-hidden",
              "fixed md:absolute inset-x-2 md:inset-x-auto md:top-[calc(100%+10px)] top-16 md:right-0 mx-auto w-[calc(100vw-16px)] md:w-[min(92vw,380px)] max-w-[420px]"
            )}
          >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div>
              <div className="text-sm font-bold text-white">Notificações</div>
              <div className="text-[11px] text-zinc-500">
                {loading ? "Carregando…" : `${unreadCount} não lida${unreadCount === 1 ? "" : "s"}`}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  disabled={markingAll}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10 rounded-lg disabled:opacity-60 transition"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  {markingAll ? "Marcando…" : "Tudo lido"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar notificações"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/10"
              >
                <X className="w-[18px] h-[18px]" />
              </button>
            </div>
          </div>

          <div className="max-h-[62vh] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="py-8 text-center text-sm text-zinc-500">Carregando…</div>
            ) : notifications.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <div className="text-3xl mb-2">🔔</div>
                <div className="text-sm font-semibold text-white">Nenhuma notificação</div>
                <div className="text-xs text-zinc-500 mt-1">
                  Quando houver novidades, elas aparecerão aqui.
                </div>
              </div>
            ) : (
              <ul className="flex flex-col">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => markAsRead(n)}
                      className={cn(
                        "w-full text-left px-4 py-3 border-b border-white/5 transition-colors",
                        !n.is_read ? "bg-white/[0.025]" : "bg-transparent",
                        "hover:bg-white/[0.055]"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="text-xl leading-none pt-0.5">{iconForType(n.type)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className={cn("text-[13.5px] font-semibold leading-snug", !n.is_read ? "text-white" : "text-zinc-200")}>
                                {(n.title || "Notificação").slice(0, 140)}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[10.5px] text-zinc-500 whitespace-nowrap">
                                {relativeTime(n.created_at)}
                              </span>
                              {!n.is_read && (
                                <span className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.7)]" />
                              )}
                            </div>
                          </div>
                          {n.message && (
                            <div className="text-[12.5px] text-zinc-400 mt-1 whitespace-pre-wrap break-words leading-snug">
                              {n.message.slice(0, 320)}
                              {n.message.length > 320 ? "…" : ""}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="px-4 py-2.5 border-t border-white/10 bg-black/40 text-[10.5px] text-zinc-600 flex items-center justify-between">
            <span>Clique em uma notificação para marcá-la como lida.</span>
            <span className="uppercase tracking-wider text-zinc-700">Fase 4</span>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
