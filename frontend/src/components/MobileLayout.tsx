import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import Logo from "./Logo";
import { TabNavigationProvider, TabId } from "./TabNavigationContext";
import NotificationBell from "./NotificationBell";

const TABS = [
  { id: "chat", label: "Chat" },
  { id: "aulas", label: "Aulas" },
  { id: "enviar", label: "Enviar" },
];

const variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0
  }),
  center: {
    x: 0,
    opacity: 1
  },
  exit: (direction: number) => ({
    x: direction < 0 ? '100%' : '-100%',
    opacity: 0
  })
};

export default function MobileLayout({
  chat,
  aulas,
  envio,
  hasChatNotification = false,
  onLogout,
  userId,
}: {
  chat: React.ReactNode;
  aulas: React.ReactNode;
  envio: React.ReactNode;
  hasChatNotification?: boolean;
  onLogout: () => void;
  userId?: string | null;
}) {
  const [[page, direction], setPage] = useState([1, 0]);
  const activeTab = page;

  const paginate = (newDirection: number) => {
    const nextTab = activeTab + newDirection;
    if (nextTab >= 0 && nextTab < TABS.length) {
      setPage([nextTab, newDirection]);
    }
  };

  const goToTab = (tabId: string) => {
    const idx = TABS.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    if (idx !== activeTab) {
      const newDirection = idx > activeTab ? 1 : -1;
      setPage([idx, newDirection]);
    }
  };

  const handleDragEnd = (event: any, info: any) => {
    const threshold = 50;
    if (info.offset.x > threshold) {
      paginate(-1);
    } else if (info.offset.x < -threshold) {
      paginate(1);
    }
  };

  const getTabContent = (index: number) => {
    switch (index) {
      case 0: return chat;
      case 1: return aulas;
      case 2: return envio;
      default: return aulas;
    }
  };

  return (
    <div className="fixed inset-0 w-screen h-screen flex flex-col bg-black text-white overflow-hidden select-none font-sans">
      {/* Header Fixo - Altura fixa de 80px */}
      <header className="h-[80px] flex flex-col justify-center bg-black z-50 flex-shrink-0">
        <div className="flex justify-between items-center px-3 mb-2">
          <button
            onClick={onLogout}
            className="px-2.5 py-1.5 bg-red-600/90 hover:bg-red-700 text-white font-semibold text-[11px] rounded-lg transition-colors"
          >
            Sair
          </button>
          <div className="flex items-center gap-1">
            <Logo className="scale-90" />
          </div>
          <div className="flex items-center gap-1.5">
            <NotificationBell userId={userId} variant="student" pollingIntervalMs={20000} />
          </div>
        </div>
        
        {/* Tabs Navigation */}
        <div className="flex px-8 relative">
          {TABS.map((tab, idx) => (
            <button
              key={tab.id}
              onClick={() => {
                const newDirection = idx > activeTab ? 1 : -1;
                if (idx !== activeTab) setPage([idx, newDirection]);
              }}
              className={cn(
                "flex-1 py-3 text-sm font-bold transition-all duration-300 relative z-10",
                activeTab === idx ? "text-white scale-110" : "text-zinc-600"
              )}
            >
              {tab.label}
              {tab.id === "chat" && hasChatNotification && (
                <span className="absolute top-2 right-4 w-2 h-2 bg-[#ef4444] rounded-full shadow-[0_0_10px_rgba(239,68,68,0.8)]" />
              )}
            </button>
          ))}
          
          {/* Indicador de Gradiente VU - Fiel ao Mockup */}
          <div className="absolute bottom-0 left-8 right-8 h-[2px] bg-zinc-800">
            <motion.div 
              className="h-full w-1/3"
              style={{ 
                background: "linear-gradient(to right, #22c55e, #eab308, #f97316, #ef4444)",
              }}
              animate={{ x: `${activeTab * 100}%` }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          </div>
        </div>
      </header>

      {/* Viewport de Conteúdo com Swipe - Usando AnimatePresence */}
      <div className="h-[calc(100vh-80px)] w-full relative overflow-hidden bg-black">
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            key={page}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: "spring", stiffness: 300, damping: 30 },
              opacity: { duration: 0.2 }
            }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={1}
            onDragEnd={handleDragEnd}
            className="absolute inset-0 w-full h-full"
          >
            <TabNavigationProvider value={{ navigateToTab: (t: TabId) => goToTab(t) }}>
              <div className="w-full h-full overflow-y-auto overflow-x-hidden flex flex-col">
                {getTabContent(activeTab)}
              </div>
            </TabNavigationProvider>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
