import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Plus,
  PlusCircle,
  FileText,
  Music,
  Trash2,
  Save,
  Pencil,
  UploadCloud,
  RefreshCw,
  BookA,
  Download,
  Play,
  Pause,
  AlertTriangle,
  Sparkles,
  Layers3,
  CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiAlert, API_BASE_URL } from "@/lib/api";

// ==============================
// TYPES
// ==============================
type InstrumentRow = {
  id: string;
  name: string;
  emoji?: string;
  missing?: boolean;
  modules_count?: number;
  lessons_count?: number;
  is_fixed?: boolean;
};

type ModuleRow = {
  id: string;
  instrument_id: string;
  title: string;
  description?: string | null;
  long_description?: string | null;
  objectives?: string | null;
  estimated_hours?: number | null;
  order?: number;
  lessons?: LessonRow[];
};

type LessonRow = {
  id: string;
  module_id: string;
  title: string;
  description?: string | null;
  long_description?: string | null;
  objectives?: string | null;
  difficulty?: "beginner" | "intermediate" | "advanced" | string;
  sheet_pdf_url?: string | null;
  sheet_pdf_name?: string | null;
  backing_track_url?: string | null;
  backing_track_name?: string | null;
  video_url?: string | null;
  order?: number;
};

const INSTRUMENTOS_FIXOS = [
  { name: "Guitarra", emoji: "🎸" },
  { name: "Baixo", emoji: "🎸" },
  { name: "Bateria", emoji: "🥁" },
  { name: "Violão", emoji: "🎸" },
  { name: "Teclado", emoji: "🎹" },
  { name: "Ukulele", emoji: "🎵" },
];

export default function BibliotecaAulas() {
  // ====== States globais ======
  const [instruments, setInstruments] = useState<InstrumentRow[]>([]);
  const [loadingInst, setLoadingInst] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [selectedInstId, setSelectedInstId] = useState<string | null>(null);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
  const [selectedType, setSelectedType] = useState<"module" | "lesson" | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);

  const refreshInstruments = useCallback(async (showAlertOnMissing = false) => {
    setLoadingInst(true);
    try {
      const res = await apiFetch(
        "/admin/library/instruments",
        { method: "GET" },
        { throwOnError: false, prefix: "Erro ao buscar instrumentos" }
      );
      if (res && res.ok) {
        const data = await res.json().catch(() => ({} as any));
        const arr: InstrumentRow[] = Array.isArray(data?.instruments) ? data.instruments : [];
        setInstruments(arr);
        const missing = arr.filter((i) => !!i.missing || !i.id).length;
        if (missing > 0 && showAlertOnMissing) {
          if (confirm(`🎯 Faltam ${missing} instrumentos fixos na biblioteca. Deseja criá-los automaticamente?`)) {
            await runBootstrap();
          }
        }
        // Auto-seleciona o 1° instrumento que tiver id (se ainda não selecionado)
        if (!selectedInstId) {
          const first = arr.find((x) => !!x.id);
          if (first) setSelectedInstId(first.id);
        }
      }
    } finally {
      setLoadingInst(false);
    }
  }, [selectedInstId]);

  const runBootstrap = useCallback(async () => {
    setBootstrapping(true);
    try {
      const res = await apiFetch(
        "/admin/library/bootstrap",
        { method: "POST", body: {} },
        { throwOnError: false, prefix: "Erro ao criar instrumentos" }
      );
      if (res && res.ok) {
        const d = await res.json().catch(() => ({}));
        const created = (d?.created || []).length;
        const already = (d?.already_exists || []).length;
        if (created > 0 || already > 0) {
          alert(`✅ Instrumentos preparados: ${created} criados · ${already} já existiam.`);
        }
      }
      await refreshInstruments(false);
    } catch (e) {
      apiAlert("Erro ao inicializar biblioteca", e);
    } finally {
      setBootstrapping(false);
    }
  }, [refreshInstruments]);

  const loadInstrumentTree = useCallback(async (instId: string) => {
    if (!instId) return;
    setLoadingTree(true);
    setSelectedModuleId(null);
    setSelectedLessonId(null);
    setSelectedType(null);
    try {
      const res = await apiFetch(
        `/admin/library/instrument/${instId}/tree`,
        { method: "GET" },
        { throwOnError: false, prefix: "Erro ao carregar trilha" }
      );
      if (res && res.ok) {
        const data = await res.json().catch(() => ({} as any));
        const mods: ModuleRow[] = Array.isArray(data?.modules) ? data.modules : [];
        setModules(mods);
        // Expande o 1º módulo por padrão para o usuário já ver as aulas
        if (mods.length > 0) {
          const firstId = mods[0].id;
          setExpandedModules((prev) => ({ ...prev, [firstId]: true }));
        }
      } else {
        setModules([]);
      }
    } catch {
      setModules([]);
    } finally {
      setLoadingTree(false);
    }
  }, []);

  // Primeira carga
  useEffect(() => {
    refreshInstruments(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Quando troca instrumento
  useEffect(() => {
    if (selectedInstId) loadInstrumentTree(selectedInstId);
    else setModules([]);
  }, [selectedInstId, loadInstrumentTree]);

  const toggleModule = (mid: string) => {
    setExpandedModules((prev) => ({ ...prev, [mid]: !prev[mid] }));
  };

  const selectModule = (mid: string) => {
    setSelectedType("module");
    setSelectedModuleId(mid);
    setSelectedLessonId(null);
  };

  const selectLesson = (lid: string, mid: string) => {
    setSelectedType("lesson");
    setSelectedLessonId(lid);
    setSelectedModuleId(mid);
  };

  const activeInstrument = instruments.find((i) => i.id === selectedInstId) || null;

  // Botão voltar no mobile: limpa seleção para voltar a ver a árvore
  useEffect(() => {
    (window as any).__bibClearSelection = () => {
      setSelectedType(null);
      setSelectedModuleId(null);
      setSelectedLessonId(null);
    };
    return () => {
      delete (window as any).__bibClearSelection;
    };
  }, []);

  // Scroll automático para o editor no mobile (abaixo da árvore em telas estreitas)
  const editorColRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (selectedType && editorColRef.current) {
      const isMobile = window.matchMedia("(max-width: 1023px)").matches;
      if (isMobile) {
        setTimeout(() => {
          editorColRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
      }
    }
  }, [selectedType, selectedModuleId, selectedLessonId]);

  return (
    <div
      className="flex-1 min-h-0 flex flex-col bg-[#050505] w-full overflow-visible"
      style={{ WebkitOverflowScrolling: 'touch' as any }}
    >
      {/* ====== HEADER DA BIBLIOTECA ====== */}
      <header className="border-b border-white/5 bg-[#0d0d0d]/60 backdrop-blur px-2.5 md:px-8 py-2.5 md:py-5 space-y-2 md:space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-3">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-9 h-9 md:w-11 md:h-11 rounded-xl md:rounded-2xl bg-gradient-to-br from-[#22c55e]/30 via-[#f97316]/30 to-[#eab308]/30 flex items-center justify-center text-xl md:text-2xl border border-white/5 shrink-0">
              <Layers3 className="w-5 h-5 md:w-6 md:h-6 text-[#eab308]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[17px] md:text-2xl font-bold text-white truncate leading-tight">
                Biblioteca Guiada
              </h1>
              <p className="text-[10.5px] md:text-sm text-zinc-500 truncate leading-tight">
                6 instrumentos · Roteiro completo
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2 w-full md:w-auto justify-start md:justify-end">
            <button
              onClick={() => refreshInstruments(false)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 md:px-3 md:py-2 rounded-lg md:rounded-xl bg-zinc-800 text-[11px] md:text-sm font-semibold text-zinc-300 hover:bg-zinc-700 hover:text-white transition shrink-0"
            >
              <RefreshCw className={cn("w-3.5 h-3.5 md:w-4 md:h-4", loadingInst && "animate-spin")} />
              Atualizar
            </button>
            <button
              onClick={runBootstrap}
              disabled={bootstrapping}
              className="inline-flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 md:py-2 rounded-lg md:rounded-xl bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-white text-[11px] md:text-sm font-bold shadow-lg shadow-green-500/10 disabled:opacity-70 active:scale-[0.98] transition whitespace-nowrap shrink-0"
            >
              <Sparkles className={cn("w-3.5 h-3.5 md:w-4 md:h-4", bootstrapping && "animate-spin")} />
              {bootstrapping ? "Preparando…" : "Preparar 6 instrumentos"}
            </button>
          </div>
        </div>

        {/* ====== SELETOR 6 INSTRUMENTOS ====== */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 md:gap-3 pb-4 md:pb-1">
          {(loadingInst ? INSTRUMENTOS_FIXOS.map((f) => ({ ...f, id: "load", modules_count: 0, lessons_count: 0 } as InstrumentRow)) : instruments.length ? instruments : INSTRUMENTOS_FIXOS.map((f) => ({ name: f.name, emoji: f.emoji, id: "", missing: true, modules_count: 0, lessons_count: 0 }))).map((inst) => {
            const isActive = selectedInstId === inst.id;
            const missing = !!inst.missing || !inst.id;
            return (
              <button
                key={inst.name + (inst.id || "")}
                disabled={missing && !bootstrapping}
                onClick={() => {
                  if (missing) runBootstrap();
                  else setSelectedInstId(inst.id);
                }}
                className={cn(
                  "group relative transition-all text-left rounded-xl md:rounded-2xl border",
                  // Portrait mobile (3 cols): SUPER compacto para os 6 cards ocuparem NO MAX 30% da tela
                  // landscape/desktop: visual normal
                  "p-1.5 md:p-4",
                  isActive
                    ? "border-[#22c55e]/50 bg-gradient-to-br from-[#22c55e]/15 via-[#f97316]/10 to-transparent shadow-[0_0_30px_rgba(34,197,94,0.13)]"
                    : missing
                      ? "border-dashed border-zinc-700 bg-zinc-900/40 hover:border-zinc-500 hover:bg-zinc-800/60"
                      : "border-white/5 bg-[#0d0d0d] hover:border-white/10 hover:bg-zinc-900/80"
                )}
              >
                <div className="flex items-start justify-between gap-1 md:gap-2">
                  <div className="text-lg md:text-3xl leading-none">{inst.emoji || "🎵"}</div>
                  {missing && (
                    <div className="px-1.5 py-0.5 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-[9px] font-bold uppercase text-yellow-400 tracking-wide">
                      Não criado
                    </div>
                  )}
                  {!missing && isActive && (
                    <CircleDot className="w-3.5 h-3.5 text-[#22c55e]" />
                  )}
                </div>
                <div className="mt-0.5 md:mt-2">
                  <div className="text-[12px] md:text-[15px] font-bold text-white truncate leading-tight">{inst.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 md:gap-2 text-[8.5px] md:text-[11px] text-zinc-500 leading-tight">
                    <BookA className="w-3 h-3 opacity-70" />
                    <span>{inst.modules_count || 0} módulos</span>
                    <span className="opacity-50">·</span>
                    <span>{inst.lessons_count || 0} aulas</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </header>

      {/* ====== CORPO ====== */}
      {!activeInstrument && !loadingTree ? (
        <EmptyState instrumentsReady={instruments.some((i) => !!i.id && !i.missing)} onBootstrap={runBootstrap} />
      ) : (
        <div
          className={cn(
            "flex-1 min-h-0 grid gap-0 border-t border-white/5 w-full",
            // DESKTOP: sempre 2 colunas
            // MOBILE: 2 colunas APENAS se houver selecao no editor (Module/LessonEditor).
            //         se nada selecionado = 1 coluna (toda largura para arvore)
            !selectedType ? "grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.55fr)]" : "grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.55fr)]"
          )}
        >
          {/* ====== COLUNA ESQUERDA: ÁRVORE MÓDULOS / AULAS ====== */}
          <aside className={cn(
            "border-r border-white/5 bg-[#0a0a0a] min-h-0 flex flex-col w-full",
            // overflow-hidden APENAS no desktop. No mobile, a arvore tem largura inteira = deixa o container pai scrollar.
            "lg:overflow-hidden"
          )}>
            {/* Header STICKY no topo do aside: botao + Modulo NUNCA desaparece */}
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-2 bg-[#0d0d0d]/70 backdrop-blur-sm sticky top-0 z-10">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">Trilha</div>
                <div className="text-sm font-semibold text-white truncate">
                  {activeInstrument ? `${activeInstrument.emoji} ${activeInstrument.name}` : "—"}
                </div>
              </div>
              <AddModuleButton
                instrumentId={activeInstrument?.id || null}
                onCreated={() => loadInstrumentTree(activeInstrument!.id)}
              />
            </div>

            <div
              className={cn(
                "flex-1 w-full",
                // Desktop: scroll interno do aside
                "lg:overflow-y-auto lg:p-3",
                // Mobile: padding interno e rola com o resto do documento (nao tem scroll interno aninhado)
                "p-3 pb-16"
              )}
              style={{ WebkitOverflowScrolling: 'touch' as any }}
            >
              {loadingTree && (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-zinc-500">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Carregando trilha…
                </div>
              )}
              {!loadingTree && modules.length === 0 && (
                <div className="mt-3 text-center px-3 py-8 rounded-xl border border-dashed border-white/10 bg-[#0d0d0d]/50 w-full max-w-[320px] mx-auto overflow-hidden">
                  <div className="text-3xl mb-2">📁</div>
                  <div className="text-[15px] md:text-sm font-semibold text-white">Sem módulos ainda</div>
                  <p className="mt-2 text-[12px] md:text-[12px] text-zinc-400 leading-relaxed w-full break-words">
                    Toque no botão{" "}
                    <span className="text-[#22c55e] font-bold inline-flex items-center gap-1 whitespace-nowrap">
                      <PlusCircle className="w-3.5 h-3.5 shrink-0" /> Módulo
                    </span>{" "}
                    ali em cima 👆 para criar a trilha de <span className="text-white font-semibold whitespace-nowrap">{activeInstrument?.name || ""}</span>.
                  </p>
                </div>
              )}
              {modules.map((mod, idxMod) => {
                const isOpen = !!expandedModules[mod.id];
                const lessons = mod.lessons || [];
                const isModuleSelected = selectedType === "module" && selectedModuleId === mod.id;
                return (
                  <div
                    key={mod.id}
                    className={cn(
                      "rounded-xl border transition",
                      isModuleSelected ? "border-[#22c55e]/40 bg-[#22c55e]/[0.035]" : "border-white/5 bg-[#0d0d0d]"
                    )}
                  >
                    <div
                      onClick={() => selectModule(mod.id)}
                      className="w-full text-left flex items-center gap-2 px-3 py-2.5 hover:bg-white/5 rounded-t-xl transition cursor-pointer"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleModule(mod.id);
                        }}
                        className="w-10 h-10 md:w-6 md:h-6 inline-flex items-center justify-center rounded-md hover:bg-white/10 text-zinc-400 hover:text-white shrink-0"
                      >
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="w-5 inline-flex items-center justify-center rounded-md bg-zinc-800 text-[10px] font-bold text-zinc-300 py-0.5">
                            {String(idxMod + 1).padStart(2, "0")}
                          </span>
                          <span className="text-sm font-semibold text-white truncate">{mod.title}</span>
                        </div>
                        <div className="mt-0.5 pl-7 text-[10.5px] text-zinc-500 flex items-center gap-2">
                          <span>{lessons.length} aula{lessons.length === 1 ? "" : "s"}</span>
                          {typeof mod.estimated_hours === "number" && (
                            <>
                              <span className="opacity-50">·</span>
                              <span>{mod.estimated_hours}h estimado</span>
                            </>
                          )}
                        </div>
                      </div>
                      <AddLessonButton
                        moduleId={mod.id}
                        instrumentId={activeInstrument?.id || null}
                        onCreated={() => loadInstrumentTree(activeInstrument!.id)}
                      />
                    </div>

                    {isOpen && lessons.length > 0 && (
                      <ul className="pb-2 px-3 pt-1 space-y-1 border-t border-white/5 mt-1">
                        {lessons.map((l, idxLess) => {
                          const isSel = selectedType === "lesson" && selectedLessonId === l.id;
                          return (
                            <li key={l.id}>
                              <button
                                onClick={() => selectLesson(l.id, mod.id)}
                                className={cn(
                                  "w-full text-left group rounded-lg pl-9 pr-2 py-2 transition flex items-center gap-2",
                                  isSel
                                    ? "bg-gradient-to-r from-[#f97316]/15 to-transparent border border-[#f97316]/20"
                                    : "hover:bg-white/[0.04]"
                                )}
                              >
                                <span className={cn(
                                  "w-[18px] shrink-0 inline-flex items-center justify-center text-[10px] font-bold rounded-sm",
                                  isSel ? "bg-[#f97316] text-white" : "bg-zinc-800 text-zinc-400"
                                )}>
                                  {String(idxLess + 1).padStart(2, "0")}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className={cn("text-[13px] font-medium truncate", isSel ? "text-white" : "text-zinc-200")}>
                                    {l.title}
                                  </div>
                                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
                                    <DifficultyBadge d={l.difficulty} />
                                    {l.sheet_pdf_url && (
                                      <span className="inline-flex items-center gap-1 text-blue-400/90">
                                        <FileText className="w-2.5 h-2.5" /> PDF
                                      </span>
                                    )}
                                    {l.backing_track_url && (
                                      <span className="inline-flex items-center gap-1 text-purple-400/90">
                                        <Music className="w-2.5 h-2.5" /> Áudio
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {isOpen && lessons.length === 0 && (
                      <div className="text-[11px] text-zinc-600 px-4 py-3 border-t border-white/5 mt-1 italic">
                        Nenhuma aula neste módulo. Clique no + acima para adicionar.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* ====== COLUNA DIREITA: DETALHE ====== */}
          {/* Mobile (abaixo de lg): renderiza APENAS se houver algo para editar. */}
          {(!selectedType ? false : true) || (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(min-width: 1024px)').matches) ? (
            <section
              ref={editorColRef as any}
              className={cn(
                "bg-[#050505] w-full",
                // Mobile: empilhado = min-h-auto + pb-24 para o final do formulario nao ser cortado
                !selectedType ? "hidden lg:flex lg:flex-col lg:min-h-0 lg:overflow-y-auto lg:px-6 lg:py-5 lg:pb-24" : "flex flex-col min-h-0 overflow-y-auto px-3 py-3 md:px-6 md:py-5 pb-32"
              )}
              style={{ WebkitOverflowScrolling: 'touch' as any }}
            >
            {selectedType === "module" && selectedModuleId && (
              <ModuleEditor
                key={"m" + selectedModuleId}
                instrumentId={activeInstrument?.id || null}
                instrumentName={activeInstrument?.name || ""}
                moduleRow={modules.find((m) => m.id === selectedModuleId) || null}
                onSaved={() => loadInstrumentTree(activeInstrument!.id)}
              />
            )}
            {selectedType === "lesson" && selectedLessonId && (
              <LessonEditor
                key={"l" + selectedLessonId}
                instrumentId={activeInstrument?.id || null}
                instrumentName={activeInstrument?.name || ""}
                moduleId={selectedModuleId!}
                lessonRow={
                  (modules.find((m) => m.id === selectedModuleId)?.lessons || []).find(
                    (l) => l.id === selectedLessonId
                  ) || null
                }
                onSaved={() => loadInstrumentTree(activeInstrument!.id)}
              />
            )}
            {!selectedType && (
              <NothingSelectedHint instrument={activeInstrument?.name || ""} modulesCount={modules.length} />
            )}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ==============================
// EMPTY STATE
// ==============================
function EmptyState({ instrumentsReady, onBootstrap }: { instrumentsReady: boolean; onBootstrap: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-5 md:px-6 pt-10 pb-28 md:py-16 md:pb-24 text-center w-full mx-auto max-w-lg">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#22c55e]/20 via-[#f97316]/15 to-[#eab308]/10 flex items-center justify-center text-5xl border border-white/5 shadow-2xl shrink-0">
        📚
      </div>
      <h2 className="mt-5 text-lg md:text-2xl font-bold text-white">
        {instrumentsReady ? "Selecione um instrumento" : "Biblioteca ainda não inicializada"}
      </h2>
      <p className="mt-3 w-full max-w-md text-sm md:text-[15px] leading-relaxed text-zinc-500 break-words">
        {instrumentsReady
          ? "Clique em um dos 6 cards de instrumento no topo para começar a construir a sua trilha pedagógica completa."
          : "Os 6 instrumentos (Guitarra, Baixo, Bateria, Violão, Teclado, Ukulele) ainda não foram criados no banco. Basta clicar abaixo para gerá-los automaticamente."}
      </p>
      {!instrumentsReady && (
        <button
          onClick={onBootstrap}
          className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-white font-bold shadow-[0_10px_30px_rgba(34,197,94,0.25)] active:scale-[0.98] transition"
        >
          <Sparkles className="w-5 h-5" />
          Criar 6 instrumentos agora
        </button>
      )}
    </div>
  );
}

function NothingSelectedHint({ instrument, modulesCount }: { instrument: string; modulesCount: number }) {
  return (
    <div className="w-full flex-1 flex flex-col items-center justify-center px-4 py-10 md:py-16 md:pb-28 text-center max-w-xl mx-auto">
      <div className="w-16 h-16 rounded-2xl bg-zinc-900/80 border border-white/5 flex items-center justify-center text-3xl shrink-0">
        ✨
      </div>
      <h3 className="mt-5 text-base md:text-lg font-bold text-white">
        {instrument ? `${instrument} · ${modulesCount} módulo${modulesCount === 1 ? "" : "s"}` : "Navegue pela trilha"}
      </h3>
      <p className="mt-3 text-[13px] md:text-sm leading-relaxed text-zinc-500 max-w-sm break-words">
        Clique em um <span className="text-[#22c55e] font-semibold">módulo</span> para editar seus
        objetivos e duração. <br className="hidden md:block" />
        Clique em uma <span className="text-[#f97316] font-semibold">aula</span> para descrever o conteúdo e anexar
        PDFs de cifras/tablaturas e backing tracks em MP3.
      </p>
    </div>
  );
}

// ==============================
// ADD MODAL: MÓDULO
// ==============================
function AddModuleButton({ instrumentId, onCreated }: { instrumentId: string | null; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!instrumentId || !title.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch(
        "/modules",
        {
          method: "POST",
          body: {
            instrument_id: instrumentId,
            title: title.trim(),
            description: "",
          },
        },
        { throwOnError: false, prefix: "Erro ao criar módulo" }
      );
      if (res && res.ok) {
        setTitle("");
        setOpen(false);
        onCreated();
      }
    } catch (e) {
      apiAlert("Erro ao criar módulo", e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!instrumentId}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#22c55e]/10 hover:bg-[#22c55e]/20 border border-[#22c55e]/20 text-[11px] font-bold text-[#22c55e] disabled:opacity-40 transition"
      >
        <Plus className="w-3.5 h-3.5" /> Módulo
      </button>
      {open && (
        <SimpleModal title="Novo módulo" onClose={() => setOpen(false)}>
          <Label>Módulo de qual instrumento?</Label>
          <div className="text-sm font-bold text-white mb-3">{instrumentId ? instrumentId : "—"}</div>
          <Label>Título do módulo</Label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Acordes abertos e pestana básica"
            className="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-white/5 focus:border-[#22c55e]/40 outline-none text-white text-sm"
          />
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-zinc-400 hover:text-white hover:bg-zinc-900 transition"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={saving || !title.trim()}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-white text-sm font-bold shadow-lg shadow-green-500/10 disabled:opacity-60 active:scale-[0.98] transition"
            >
              {saving ? "Criando…" : "Criar módulo"}
            </button>
          </div>
        </SimpleModal>
      )}
    </>
  );
}

// ==============================
// ADD MODAL: AULA
// ==============================
function AddLessonButton({ moduleId, instrumentId, onCreated }: { moduleId: string | null; instrumentId: string | null; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!moduleId || !title.trim()) return;
    setSaving(true);
    try {
      // Insere a aula diretamente (RPC insert_lesson já existente? Para simplificar,
      // usamos POST direto via rpc ou insert padrão — aqui usamos um endpoint manual para não depender de RPC)
      const body: Record<string, any> = {
        module_id: moduleId,
        title: title.trim(),
        description: "",
        instrument_id: instrumentId,
      };
      const res = await apiFetch(
        "/lessons/create",
        { method: "POST", body },
        { throwOnError: false, prefix: "Erro ao criar aula" }
      );
      if (!res || !res.ok) {
        // Fallback: usa o endpoint upload-lesson-video com file vazio? Não, pois requer vídeo.
        // Tenta RPC insert_lesson (igual ao create_module do projeto)
        try {
          const res2 = await apiFetch(
            "/admin/library/create-lesson",
            {
              method: "POST",
              body: {
                module_id: moduleId,
                title: title.trim(),
                description: "",
              },
            },
            { throwOnError: false, prefix: "Erro ao criar aula" }
          );
          if (res2 && res2.ok) {
            setTitle("");
            setOpen(false);
            onCreated();
          }
        } catch (e2) {
          apiAlert("Erro ao criar aula", e2);
        }
      } else {
        setTitle("");
        setOpen(false);
        onCreated();
      }
    } catch (e) {
      apiAlert("Erro ao criar aula", e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        disabled={!moduleId}
        aria-label="Adicionar aula"
        className="w-11 h-11 md:w-7 md:h-7 inline-flex items-center justify-center rounded-lg hover:bg-white/10 text-zinc-500 hover:text-[#22c55e] shrink-0 transition"
      >
        <Plus className="w-5 h-5 md:w-4 md:h-4" />
      </button>
      {open && (
        <SimpleModal title="Nova aula" onClose={() => setOpen(false)}>
          <Label>Título da aula</Label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Forma do acorde Dm + pestana com dedo 1"
            className="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-white/5 focus:border-[#22c55e]/40 outline-none text-white text-sm"
          />
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-zinc-400 hover:text-white hover:bg-zinc-900 transition"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={saving || !title.trim()}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white text-sm font-bold shadow-lg shadow-orange-500/10 disabled:opacity-60 active:scale-[0.98] transition"
            >
              {saving ? "Criando…" : "Criar aula"}
            </button>
          </div>
        </SimpleModal>
      )}
    </>
  );
}

// ==============================
// MODULE EDITOR
// ==============================
function ModuleEditor({
  instrumentId,
  instrumentName,
  moduleRow,
  onSaved,
}: {
  instrumentId: string | null;
  instrumentName: string;
  moduleRow: ModuleRow | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(moduleRow?.title || "");
  const [description, setDescription] = useState(moduleRow?.description || "");
  const [longDescription, setLongDescription] = useState(moduleRow?.long_description || "");
  const [objectives, setObjectives] = useState(moduleRow?.objectives || "");
  const [estimatedHours, setEstimatedHours] = useState<string>(String(moduleRow?.estimated_hours ?? ""));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!moduleRow) return;
    setTitle(moduleRow.title || "");
    setDescription(moduleRow.description || "");
    setLongDescription(moduleRow.long_description || "");
    setObjectives(moduleRow.objectives || "");
    setEstimatedHours(String(moduleRow.estimated_hours ?? ""));
  }, [moduleRow]);

  async function save() {
    if (!instrumentId || !moduleRow) return;
    setSaving(true);
    try {
      const res = await apiFetch(
        `/admin/library/modules/${moduleRow.id}`,
        {
          method: "PATCH",
          body: {
            title,
            description,
            long_description: longDescription || null,
            objectives: objectives || null,
            estimated_hours: estimatedHours.trim() ? parseInt(estimatedHours) : null,
          },
        },
        { throwOnError: false, prefix: "Erro ao salvar módulo" }
      );
      if (res && res.ok) {
        alert("✅ Módulo salvo com sucesso!");
        onSaved();
      }
    } catch (e) {
      apiAlert("Erro ao salvar módulo", e);
    } finally {
      setSaving(false);
    }
  }

  if (!moduleRow) {
    return <div className="p-8 text-zinc-500 text-sm">Nenhum módulo selecionado.</div>;
  }
  const nLessons = (moduleRow.lessons || []).length;

  return (
    <div className="p-5 md:p-7 lg:p-8 space-y-6 max-w-4xl mx-auto">
      <button
        onClick={() => { (window as any).__bibClearSelection?.(); }}
        className="lg:hidden inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-800/80 text-xs font-bold text-zinc-300 hover:bg-zinc-700 hover:text-white transition mb-2"
      >
        <ChevronLeft className="w-4 h-4" /> Voltar para trilha
      </button>
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase font-bold tracking-wider text-zinc-500">
            {instrumentName} · Módulo
          </div>
          <h2 className="mt-1 text-xl md:text-2xl font-bold text-white">Editando módulo</h2>
          <p className="mt-1 text-xs md:text-sm text-zinc-500">
            {nLessons} aula{nLessons === 1 ? "" : "s"} · Posição #{moduleRow.order ?? "?"} na trilha
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || !title.trim()}
          className="md:mt-1 inline-flex items-center gap-2 px-4 py-3 md:py-2.5 rounded-xl bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-white text-sm font-bold shadow-lg shadow-green-500/10 disabled:opacity-60 active:scale-[0.98] transition whitespace-nowrap min-h-[44px]"
        >
          <Save className="w-4 h-4" /> {saving ? "Salvando…" : "Salvar módulo"}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-5">
        <div>
          <Label>Título do módulo</Label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 focus:border-[#22c55e]/40 outline-none text-white text-sm"
          />
        </div>
        <div>
          <Label>Descrição curta (1 linha, para listas)</Label>
          <input
            value={description ?? ""}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Primeiros passos com as mãos e postura"
            className="w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 focus:border-[#22c55e]/40 outline-none text-white text-sm"
          />
        </div>
        <div>
          <Label>Horas estimadas para concluir o módulo</Label>
          <div className="flex items-center gap-3">
            <input
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
              inputMode="numeric"
              placeholder="12"
              className="w-32 px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 focus:border-[#22c55e]/40 outline-none text-white text-sm"
            />
            <span className="text-xs text-zinc-500">horas de estudo sugerido para o aluno finalizar</span>
          </div>
        </div>
        <div>
          <Label>Descrição longa / Programa completo do módulo</Label>
          <textarea
            value={longDescription ?? ""}
            onChange={(e) => setLongDescription(e.target.value)}
            rows={6}
            placeholder="Conteúdo detalhado que você vai cobrar, passo a passo. Ex: Semana 1 — Postura + dedilhado. Semana 2 — Acordes A, D, G…"
            className="w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 focus:border-[#22c55e]/40 outline-none text-white text-sm resize-y min-h-[140px]"
          />
        </div>
        <div>
          <Label>Objetivos de aprendizagem</Label>
          <textarea
            value={objectives ?? ""}
            onChange={(e) => setObjectives(e.target.value)}
            rows={4}
            placeholder="✓ Conseguirá fazer batida em 4/4 em D, G, A sem parar\n✓ Terá a pestana F memorizada\n…"
            className="w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 focus:border-[#22c55e]/40 outline-none text-white text-sm resize-y"
          />
        </div>
      </div>
    </div>
  );
}

// ==============================
// LESSON EDITOR (com drag & drop PDF / MP3)
// ==============================
function LessonEditor({
  instrumentId,
  instrumentName,
  moduleId,
  lessonRow,
  onSaved,
}: {
  instrumentId: string | null;
  instrumentName: string;
  moduleId: string;
  lessonRow: LessonRow | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(lessonRow?.title || "");
  const [description, setDescription] = useState(lessonRow?.description || "");
  const [longDescription, setLongDescription] = useState(lessonRow?.long_description || "");
  const [objectives, setObjectives] = useState(lessonRow?.objectives || "");
  const [difficulty, setDifficulty] = useState<"beginner" | "intermediate" | "advanced">(
    (["beginner", "intermediate", "advanced"].includes(lessonRow?.difficulty || "")
      ? (lessonRow?.difficulty as any)
      : "beginner") || "beginner"
  );
  const [saving, setSaving] = useState(false);

  const [sheetUrl, setSheetUrl] = useState(lessonRow?.sheet_pdf_url || null);
  const [sheetName, setSheetName] = useState(lessonRow?.sheet_pdf_name || null);
  const [sheetUploading, setSheetUploading] = useState(false);
  const [sheetDrag, setSheetDrag] = useState(false);
  const sheetInputRef = useRef<HTMLInputElement>(null);

  const [audioUrl, setAudioUrl] = useState(lessonRow?.backing_track_url || null);
  const [audioName, setAudioName] = useState(lessonRow?.backing_track_name || null);
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioDrag, setAudioDrag] = useState(false);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingAudio, setPlayingAudio] = useState(false);

  useEffect(() => {
    if (!lessonRow) return;
    setTitle(lessonRow.title || "");
    setDescription(lessonRow.description || "");
    setLongDescription(lessonRow.long_description || "");
    setObjectives(lessonRow.objectives || "");
    setDifficulty(
      (["beginner", "intermediate", "advanced"].includes(lessonRow.difficulty || "")
        ? (lessonRow.difficulty as any)
        : "beginner") || "beginner"
    );
    setSheetUrl(lessonRow.sheet_pdf_url || null);
    setSheetName(lessonRow.sheet_pdf_name || null);
    setAudioUrl(lessonRow.backing_track_url || null);
    setAudioName(lessonRow.backing_track_name || null);
  }, [lessonRow]);

  async function save() {
    if (!lessonRow) return;
    setSaving(true);
    try {
      const res = await apiFetch(
        `/admin/library/lessons/${lessonRow.id}`,
        {
          method: "PATCH",
          body: {
            title,
            description,
            long_description: longDescription || null,
            objectives: objectives || null,
            difficulty,
            sheet_pdf_url: sheetUrl,
            sheet_pdf_name: sheetName,
            backing_track_url: audioUrl,
            backing_track_name: audioName,
          },
        },
        { throwOnError: false, prefix: "Erro ao salvar aula" }
      );
      if (res && res.ok) {
        const note = (await res.json().catch(() => null))?.note;
        if (note && note.includes("new_columns_missing_only")) {
          alert(
            "⚠️ Campos novos da Biblioteca não foram salvos no banco ainda.\n\n" +
              "Aplique a migration SQL '20260816180000_biblioteca_aulas.sql' no Supabase para habilitar PDF, backing track e descrições completas.\n" +
              "(O título e descrição legado foram salvos normalmente.)"
          );
        } else {
          alert("✅ Aula salva com sucesso!");
        }
        onSaved();
      }
    } catch (e) {
      apiAlert("Erro ao salvar aula", e);
    } finally {
      setSaving(false);
    }
  }

  async function handleFiles(files: FileList | File[] | null, kind: "sheet" | "audio") {
    if (!files) return;
    const file = (files as File[])[0] || (files as FileList)[0] || null;
    if (!file) return;
    if (!instrumentId || !moduleId || !lessonRow) {
      alert("Erro: identidade da aula não carregada. Recarregue a página.");
      return;
    }
    if (kind === "sheet") {
      if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
        alert("Arquivo inválido: a cifra/tablatura precisa ser PDF.");
        return;
      }
      if (file.size > 30 * 1024 * 1024) {
        alert("PDF muito grande. Tamanho máximo permitido: 30 MB.");
        return;
      }
    } else {
      if (!/\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(file.name) && !(file.type || "").startsWith("audio")) {
        alert("Arquivo inválido: o backing track precisa ser áudio (MP3, M4A, WAV ou OGG).");
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        alert("Áudio muito grande. Tamanho máximo permitido: 20 MB.");
        return;
      }
    }

    if (kind === "sheet") setSheetUploading(true);
    else setAudioUploading(true);

    try {
      const fd = new FormData();
      fd.append("instrument_id", instrumentId);
      fd.append("module_id", moduleId);
      fd.append("lesson_id", lessonRow.id);
      fd.append("material_type", kind === "sheet" ? "sheet_pdf" : "backing_track");
      fd.append("file", file);
      const res = await apiFetch(
        "/admin/library/upload-material",
        {
          method: "POST",
          body: fd,
          // Não usar jsonBody automático pois é FormData
        } as any,
        { jsonBody: false, bearer: true, throwOnError: false, prefix: "Erro ao enviar arquivo" }
      );
      if (res && res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.public_url) {
          if (kind === "sheet") {
            setSheetUrl(data.public_url);
            setSheetName(data.original_filename || file.name);
          } else {
            setAudioUrl(data.public_url);
            setAudioName(data.original_filename || file.name);
          }
          alert(
            `✅ Arquivo enviado!\n\n` +
              `Armazenado em: library_materials/${instrumentId?.slice(0, 6)}…/${moduleId?.slice(0, 6)}…/${lessonRow.id.slice(0, 6)}…/\n\n` +
              `Clique em "Salvar aula" para gravar a referência definitivamente.`
          );
        }
      }
    } catch (e) {
      apiAlert("Erro ao enviar arquivo", e);
    } finally {
      if (kind === "sheet") setSheetUploading(false);
      else setAudioUploading(false);
    }
  }

  async function removeMaterial(kind: "sheet" | "audio") {
    if (!lessonRow) return;
    const prev = kind === "sheet" ? sheetUrl : audioUrl;
    if (!prev) return;
    if (!confirm(`Remover ${kind === "sheet" ? "o PDF de cifras" : "o backing track"} dessa aula?`)) return;
    // Tenta extrair r2_key para deletar do R2
    let r2Key = "";
    try {
      const pubBase = (window as any).ENV_LIB_PUB?.PUBLIC || "";
      // Se não temos a ENV, tenta extrair da URL pela posição após .dev/ ou .r2.cloudflarestorage.com/bucketname/
      // O backend retorna r2_key no upload, mas após refresh não temos mais. Deleta apenas a referência do banco (seguro).
      void pubBase;
    } catch {
      // noop
    }
    try {
      if (r2Key) {
        await apiFetch(
          `/admin/library/material?r2_key=${encodeURIComponent(r2Key)}&lesson_id=${encodeURIComponent(lessonRow.id)}&material_type=${kind === "sheet" ? "sheet_pdf" : "backing_track"}`,
          { method: "DELETE" },
          { throwOnError: false }
        );
      }
    } catch {
      // noop
    }
    if (kind === "sheet") {
      setSheetUrl(null);
      setSheetName(null);
    } else {
      setAudioUrl(null);
      setAudioName(null);
      if (audioRef.current) {
        try { audioRef.current.pause(); } catch { /* noop */ }
      }
      setPlayingAudio(false);
    }
    alert("Referência removida. Clique em 'Salvar aula' para confirmar no banco.");
  }

  return (
    <div className="p-5 md:p-7 lg:p-8 space-y-6 max-w-4xl mx-auto">
      <button
        onClick={() => { (window as any).__bibClearSelection?.(); }}
        className="lg:hidden inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-800/80 text-xs font-bold text-zinc-300 hover:bg-zinc-700 hover:text-white transition mb-2"
      >
        <ChevronLeft className="w-4 h-4" /> Voltar para trilha
      </button>
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase font-bold tracking-wider text-zinc-500">
            {instrumentName} · Aula
          </div>
          <h2 className="mt-1 text-xl md:text-2xl font-bold text-white">
            {lessonRow ? `Aula ${String(lessonRow.order ?? "?").padStart(2, "0")}: Editando` : "Nova aula"}
          </h2>
          <div className="mt-1 text-xs md:text-sm text-zinc-500 flex items-center gap-2 flex-wrap">
            <DifficultyBadge d={difficulty} long />
            {sheetUrl && (
              <span className="inline-flex items-center gap-1 text-blue-400/90 font-bold">
                <FileText className="w-3 h-3" /> Cifra/Tablatura anexada
              </span>
            )}
            {audioUrl && (
              <span className="inline-flex items-center gap-1 text-purple-400/90 font-bold">
                <Music className="w-3 h-3" /> Backing track anexado
              </span>
            )}
          </div>
        </div>
        <button
          onClick={save}
          disabled={saving || !title.trim() || !lessonRow}
          className="md:mt-1 inline-flex items-center gap-2 px-4 py-3 md:py-2.5 rounded-xl bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white text-sm font-bold shadow-lg shadow-orange-500/10 disabled:opacity-60 active:scale-[0.98] transition whitespace-nowrap min-h-[44px]"
        >
          <Save className="w-4 h-4" /> {saving ? "Salvando…" : "Salvar aula"}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-5">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-4">
          <div>
            <Label>Título da aula</Label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 focus:border-[#f97316]/40 outline-none text-white text-sm"
            />
          </div>
          <div>
            <Label>Dificuldade</Label>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-zinc-900 border border-white/5">
              {(["beginner", "intermediate", "advanced"] as const).map((d) => {
                const sel = difficulty === d;
                const label = d === "beginner" ? "Iniciante" : d === "intermediate" ? "Interm." : "Avanç.";
                const cls =
                  d === "beginner"
                    ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                    : d === "intermediate"
                      ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
                      : "text-orange-400 bg-orange-500/10 border-orange-500/30";
                return (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={cn(
                      "px-2 py-2 rounded-lg text-[11px] md:text-xs font-bold transition border",
                      sel ? `${cls} shadow` : "bg-transparent border-transparent text-zinc-500 hover:text-white hover:bg-white/5"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <Label>Resumo curto (1 linha, para listagens)</Label>
          <input
            value={description ?? ""}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Dedilhado em G usando os 4 dedos da mão direita com metrônomo em 80 BPM"
            className="w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 focus:border-[#f97316]/40 outline-none text-white text-sm"
          />
        </div>

        <div>
          <Label>Descrição completa / Passo-a-passo do que ensinar</Label>
          <textarea
            value={longDescription ?? ""}
            onChange={(e) => setLongDescription(e.target.value)}
            rows={6}
            placeholder="Escreva aqui seu roteiro de aula. Ex: 1) Aquecimento dedilhado 5min. 2) Explicação da pestana F (2 posições). 3) Exercício lento com metrônomo em 60 BPM. 4) Exercício rápido 80 BPM. 5) Tocar 3 músicas que usam F."
            className="w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 focus:border-[#f97316]/40 outline-none text-white text-sm resize-y min-h-[160px]"
          />
        </div>

        <div>
          <Label>Objetivos de aprendizagem da aula</Label>
          <textarea
            value={objectives ?? ""}
            onChange={(e) => setObjectives(e.target.value)}
            rows={3}
            placeholder="✓ Consegue fazer pestana F e Fm limpo (sem buzz) em 80% das tentativas\n✓ Consegue trocar do G pro F em menos de 1 segundo\n…"
            className="w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 focus:border-[#f97316]/40 outline-none text-white text-sm resize-y"
          />
        </div>

        {/* UPLOADS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {/* ===== PDF / CIFRA ===== */}
          <div>
            <Label>
              <span className="inline-flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-blue-400" /> Cifra / Tablatura (PDF)
              </span>
            </Label>
            {!sheetUrl ? (
              <>
                <input
                  ref={sheetInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files, "sheet")}
                />
                <div
                  onClick={() => sheetInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setSheetDrag(true); }}
                  onDragLeave={() => setSheetDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setSheetDrag(false);
                    handleFiles(e.dataTransfer.files, "sheet");
                  }}
                  className={cn(
                    "cursor-pointer rounded-2xl border-2 border-dashed px-4 py-8 text-center transition",
                    sheetUploading
                      ? "border-blue-500/60 bg-blue-500/[0.04]"
                      : sheetDrag
                        ? "border-blue-400 bg-blue-500/[0.07] scale-[1.01]"
                        : "border-white/10 bg-zinc-900/40 hover:border-white/20 hover:bg-zinc-900/70"
                  )}
                >
                  {sheetUploading ? (
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
                      <div className="text-sm font-bold text-blue-300">Enviando PDF…</div>
                      <div className="text-[11px] text-zinc-500">Máx 30 MB</div>
                    </div>
                  ) : (
                    <>
                      <UploadCloud className="w-9 h-9 mx-auto text-blue-400/90 mb-1.5" />
                      <div className="text-sm font-bold text-white">Arraste o PDF aqui</div>
                      <div className="text-[11.5px] text-zinc-500 mt-1">
                        ou <span className="text-blue-400 font-semibold">clique para selecionar</span>
                      </div>
                      <div className="text-[10.5px] text-zinc-600 mt-2">PDF de cifra/tablatura · máx 30 MB</div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.05] p-4 space-y-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white truncate">{sheetName || "Cifra.pdf"}</div>
                    <div className="text-[11px] text-blue-400/90 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 opacity-70" /> Lembre de clicar em "Salvar aula"
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <a
                      href={sheetUrl || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[11px] font-bold text-blue-300 hover:bg-blue-500/20 transition"
                    >
                      <Download className="w-3 h-3" /> Baixar
                    </a>
                    <button
                      onClick={() => removeMaterial("sheet")}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] font-bold text-red-300 hover:bg-red-500/20 transition"
                    >
                      <Trash2 className="w-3 h-3" /> Remover
                    </button>
                  </div>
                </div>
                <iframe
                  src={(sheetUrl || "") + "#toolbar=1"}
                  className="w-full h-[360px] md:h-[260px] rounded-xl bg-white/5 border border-white/10"
                  title="Pré-visualização PDF"
                />
              </div>
            )}
          </div>

          {/* ===== BACKING TRACK ===== */}
          <div>
            <Label>
              <span className="inline-flex items-center gap-1.5">
                <Music className="w-3.5 h-3.5 text-purple-400" /> Backing Track (áudio MP3)
              </span>
            </Label>
            {!audioUrl ? (
              <>
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.flac"
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files, "audio")}
                />
                <div
                  onClick={() => audioInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setAudioDrag(true); }}
                  onDragLeave={() => setAudioDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setAudioDrag(false);
                    handleFiles(e.dataTransfer.files, "audio");
                  }}
                  className={cn(
                    "cursor-pointer rounded-2xl border-2 border-dashed px-4 py-8 text-center transition",
                    audioUploading
                      ? "border-purple-500/60 bg-purple-500/[0.04]"
                      : audioDrag
                        ? "border-purple-400 bg-purple-500/[0.07] scale-[1.01]"
                        : "border-white/10 bg-zinc-900/40 hover:border-white/20 hover:bg-zinc-900/70"
                  )}
                >
                  {audioUploading ? (
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="w-8 h-8 text-purple-400 animate-spin" />
                      <div className="text-sm font-bold text-purple-300">Enviando áudio…</div>
                      <div className="text-[11px] text-zinc-500">Máx 20 MB · MP3/M4A/WAV</div>
                    </div>
                  ) : (
                    <>
                      <UploadCloud className="w-9 h-9 mx-auto text-purple-400/90 mb-1.5" />
                      <div className="text-sm font-bold text-white">Arraste o áudio aqui</div>
                      <div className="text-[11.5px] text-zinc-500 mt-1">
                        ou <span className="text-purple-400 font-semibold">clique para selecionar</span>
                      </div>
                      <div className="text-[10.5px] text-zinc-600 mt-2">
                        Backing track em MP3/M4A/WAV · máx 20 MB
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.05] p-4 space-y-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                    <Music className="w-5 h-5 text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white truncate">{audioName || "backing_track.mp3"}</div>
                    <div className="text-[11px] text-purple-400/90 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 opacity-70" /> Lembre de clicar em "Salvar aula"
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        const a = audioRef.current;
                        if (!a || !audioUrl) return;
                        try {
                          if (a.paused) { a.play().then(() => setPlayingAudio(true)).catch(() => setPlayingAudio(false)); }
                          else { a.pause(); setPlayingAudio(false); }
                        } catch { setPlayingAudio(false); }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-[11px] font-bold text-purple-300 hover:bg-purple-500/20 transition"
                    >
                      {playingAudio ? <><Pause className="w-3 h-3" /> Pausar</> : <><Play className="w-3 h-3" /> Ouvir</>}
                    </button>
                    <a
                      href={audioUrl || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] font-bold text-zinc-300 hover:bg-white/10 hover:text-white transition"
                    >
                      <Download className="w-3 h-3" /> Baixar
                    </a>
                    <button
                      onClick={() => removeMaterial("audio")}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] font-bold text-red-300 hover:bg-red-500/20 transition"
                    >
                      <Trash2 className="w-3 h-3" /> Remover
                    </button>
                  </div>
                </div>

                <audio
                  ref={audioRef}
                  src={audioUrl || undefined}
                  onPlay={() => setPlayingAudio(true)}
                  onPause={() => setPlayingAudio(false)}
                  onEnded={() => setPlayingAudio(false)}
                  controls
                  className="w-full rounded-xl"
                >
                  Seu navegador não suporta tag de áudio.
                </audio>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==============================
// HELPERS UI
// ==============================
function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5 ml-0.5">{children}</div>
  );
}

function DifficultyBadge({ d, long = false }: { d?: string; long?: boolean }) {
  const level = (d || "beginner").toLowerCase();
  const labelShort =
    level === "beginner" ? "Inic." : level === "intermediate" ? "Int." : "Avan.";
  const labelLong =
    level === "beginner" ? "Iniciante" : level === "intermediate" ? "Intermediário" : "Avançado";
  const color =
    level === "beginner"
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
      : level === "intermediate"
        ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/20"
        : "text-orange-400 bg-orange-500/10 border-orange-500/20";
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold uppercase", color)}>
      {long ? labelLong : labelShort}
    </span>
  );
}

function SimpleModal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", h);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", h); window.removeEventListener("keydown", esc); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 md:p-6">
      <div
        ref={ref}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d0d0d] p-5 md:p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}

// Expõe global interno (para fallback da feature de delete URL — vazio por enquanto)
if (typeof window !== "undefined") {
  (window as any).ENV_LIB_PUB = Object.assign((window as any).ENV_LIB_PUB || {}, {
    API_BASE: API_BASE_URL,
  });
}
