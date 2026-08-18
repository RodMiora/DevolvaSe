"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Music4, Guitar, BookOpen, Target, Star, User, Edit3, Save,
  Sparkles, Music2, Headphones, Award, Play, Plus, X,
  ChevronDown, TrendingUp, Clock as ClockIcon, CheckCircle2,
  Zap, BookMarked, Search, SlidersHorizontal, ExternalLink, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiAlert } from "@/lib/api";
import {
  loadSpDraft,
  saveSpDraft,
  clearSpDraft,
  type StudentProfileDraft,
} from "@/lib/persistNav";

// ============================================================
// TIPOS
// ============================================================
type SkillLevel = "nao_iniciado" | "basico" | "em_desenvolvimento" | "dominado";
type Level = "iniciante" | "basico" | "intermediario" | "intermediario_avancado" | "avancado";

interface MusicProfile {
  main_instrument: string | null;
  other_instruments: string[];
  level: Level | null;
  experience_text: string | null;
  styles: string[];
  objectives: string[];
  main_objective: string | null;
  difficulties: string[];
  observations: string | null;
  skills: Record<string, Record<string, SkillLevel>>;
  preferences: {
    favorite_artists: string[];
    favorite_songs: string[];
    favorite_styles: string[];
    want_to_learn: string[];
  };
  repertory: {
    learning: { name?: string; song_id?: string }[];
    mastered: { name?: string; song_id?: string }[];
    planned:  { name?: string; song_id?: string }[];
  };
}

// --- Novos tipos Integração Biblioteca <-> Perfil ---
type RepertoryStatus = "planned" | "learning" | "mastered";

interface LibSongAppliedInstrument { id?: string; name?: string }
interface LibSongObjective { id?: string; name?: string; slug?: string }
interface LibSongTechnique { id?: string; name?: string; slug?: string; category?: string }
interface LibSong {
  id: string;
  title: string | null;
  artist: string | null;
  composer?: string | null;
  year?: number | null;
  description?: string | null;
  main_style?: string | null;
  sub_style?: string | null;
  time_signature?: string | null;
  bpm?: number | null;
  original_key?: string | null;
  predominant_instrument_id?: string | null;
  predominant_instrument?: LibSongAppliedInstrument | null;
  level?: string | null;
  rhythm_complexity?: string | null;
  harmonic_complexity?: string | null;
  technical_complexity?: string | null;
  chord_count?: number;
  chords_list?: string[];
  has_barre_chord?: boolean;
  has_7th_chords?: boolean;
  has_extended_chords?: boolean;
  chords_text?: string | null;
  lyrics_chords?: string | null;
  listen_url?: string | null;
  applicable_instruments?: LibSongAppliedInstrument[];
  objectives?: LibSongObjective[];
  techniques?: LibSongTechnique[];
  is_favorite?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

interface RepertoryItem {
  id: string;
  student_id: string;
  song_id: string;
  status: RepertoryStatus;
  progresso: number;        // 0..100
  observacao: string | null;
  data_inicio: string | null;
  data_conclusao: string | null;
  ordem: number | null;
  created_at: string | null;
  updated_at: string | null;
  song: LibSong | null;
}

interface Suggestion { song: LibSong; score: number; reasons: string[] }

const STATUS_LABEL: Record<RepertoryStatus, string> = {
  planned: "Próximas",
  learning: "Aprendendo",
  mastered: "Dominadas",
};
const STATUS_COLOR: Record<RepertoryStatus, string> = {
  planned: "purple",
  learning: "orange",
  mastered: "green",
};
const STATUS_ACCENT_TEXT: Record<RepertoryStatus, string> = {
  planned: "text-[#c084fc]",
  learning: "text-[#fb923c]",
  mastered: "text-[#4ade80]",
};
const STATUS_ACCENT_BG: Record<RepertoryStatus, string> = {
  planned: "bg-[#a855f7]",
  learning: "bg-[#f97316]",
  mastered: "bg-[#22c55e]",
};
const STATUS_ACCENT_RING: Record<RepertoryStatus, string> = {
  planned: "ring-[#a855f7]/30",
  learning: "ring-[#f97316]/30",
  mastered: "ring-[#22c55e]/30",
};

const INSTRUMENTS = ["Guitarra", "Violão", "Baixo", "Bateria", "Teclado", "Ukulele", "Canto", "Outro"];
const LEVELS: { value: Level | ""; label: string }[] = [
  { value: "", label: "Selecione..." },
  { value: "iniciante", label: "Iniciante" },
  { value: "basico", label: "Básico" },
  { value: "intermediario", label: "Intermediário" },
  { value: "intermediario_avancado", label: "Intermediário/Avançado" },
  { value: "avancado", label: "Avançado" },
];
const STYLE_OPTIONS = ["Gospel","Worship","Rock","Pop","MPB","Sertanejo","Jazz","Blues","Funk","Soul","Country","Música clássica","Eletrônica","Forró","Pagode","Outros"];
const OBJECTIVE_OPTIONS = [
  "Aprender músicas","Acompanhar cantando","Tocar na igreja","Tocar em banda",
  "Tocar profissionalmente","Melhorar técnica","Melhorar ritmo","Aprender acordes",
  "Aprender escalas","Improvisação","Dedilhado","Solos","Teoria musical",
  "Leitura musical","Composição","Gravação","Outro"
];
const DIFFICULTY_OPTIONS = [
  "Troca de acordes","Pestanas","Ritmo","Coordenação","Mão direita","Mão esquerda",
  "Tempo","Metrônomo","Leitura de cifras","Memorização","Improvisação",
  "Teoria","Postura","Técnica","Outro"
];

const SKILL_CATEGORIES: { key: string; label: string; accent: "green"|"orange"|"purple"; skills: { key: string; label: string }[] }[] = [
  {
    key: "tecnica",
    label: "Técnica",
    accent: "green",
    skills: [
      { key: "acordes_abertos", label: "Acordes abertos" },
      { key: "pestanas", label: "Pestanas" },
      { key: "power_chords", label: "Power chords" },
      { key: "dedilhado", label: "Dedilhado" },
      { key: "palhetada", label: "Palhetada" },
      { key: "alternate_picking", label: "Alternate picking" },
      { key: "bends", label: "Bends" },
      { key: "vibrato", label: "Vibrato" },
      { key: "slides", label: "Slides" },
      { key: "hammer_on", label: "Hammer-on" },
      { key: "pull_off", label: "Pull-off" },
    ]
  },
  {
    key: "ritmo",
    label: "Ritmo",
    accent: "orange",
    skills: [
      { key: "pulsacao", label: "Pulsação" },
      { key: "batidas_basicas", label: "Batidas básicas" },
      { key: "acompanhamento", label: "Acompanhamento" },
      { key: "metrobolo", label: "Uso de metrônomo" },
      { key: "sincope", label: "Síncope" },
      { key: "ritmos_brasileiros", label: "Ritmos brasileiros" },
      { key: "mudanca_ritmo", label: "Mudança de ritmo" },
    ]
  },
  {
    key: "teoria",
    label: "Teoria",
    accent: "purple",
    skills: [
      { key: "notas", label: "Notas" },
      { key: "intervalos", label: "Intervalos" },
      { key: "formacao_acordes", label: "Formação de acordes" },
      { key: "campo_harmonico", label: "Campo harmônico" },
      { key: "escalas", label: "Escalas" },
      { key: "tonalidade", label: "Tonalidade" },
      { key: "cifras", label: "Cifras" },
      { key: "leitura_musical", label: "Leitura musical" },
    ]
  },
];

const SKILL_LEVELS: { value: SkillLevel; label: string }[] = [
  { value: "nao_iniciado", label: "Não iniciado" },
  { value: "basico", label: "Básico" },
  { value: "em_desenvolvimento", label: "Em desenvolvimento" },
  { value: "dominado", label: "Dominado" },
];

const EMPTY_PROFILE: MusicProfile = {
  main_instrument: null,
  other_instruments: [],
  level: null,
  experience_text: null,
  styles: [],
  objectives: [],
  main_objective: null,
  difficulties: [],
  observations: null,
  skills: {},
  preferences: {
    favorite_artists: [],
    favorite_songs: [],
    favorite_styles: [],
    want_to_learn: [],
  },
  repertory: {
    learning: [],
    mastered: [],
    planned: [],
  },
};

// ============================================================
// UI KIT (mesmo padrao visual BibliotecaMusical)
// ============================================================
const SectionHeader: React.FC<{ title: string; sub?: string; icon?: React.ReactNode; accent?: "green"|"orange"|"purple" }> = ({
  title, sub, icon, accent = "orange"
}) => {
  const grad = accent === "green"
    ? "from-[#22c55e]/30 to-transparent text-[#22c55e]"
    : accent === "purple"
      ? "from-[#a855f7]/30 to-transparent text-[#a855f7]"
      : "from-[#f97316]/30 to-transparent text-[#f97316]";
  return (
    <div className="flex items-center gap-3 pb-3 mb-3 border-b border-white/5">
      <div className={cn("w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center border border-white/5 shrink-0", grad)}>
        {icon}
      </div>
      <div className="min-w-0">
        <h4 className="text-white text-[15px] font-bold leading-tight">{title}</h4>
        {sub && <p className="text-zinc-500 text-[12px] leading-tight truncate">{sub}</p>}
      </div>
    </div>
  );
};

const TextInput: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string; readOnly?: boolean }> = ({ label, value, onChange, placeholder, readOnly }) => (
  <label className="block space-y-1.5">
    <span className="text-[11px] md:text-xs font-bold text-zinc-400 uppercase tracking-wide">{label}</span>
    <input
      type="text"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      className="w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 outline-none text-white text-sm placeholder:text-zinc-600 transition focus:border-[#22c55e]/40 disabled:opacity-60"
    />
  </label>
);

const TextArea: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string; minH?: string; readOnly?: boolean }> = ({ label, value, onChange, placeholder, minH = "min-h-[90px]", readOnly }) => (
  <label className="block space-y-1.5">
    <span className="text-[11px] md:text-xs font-bold text-zinc-400 uppercase tracking-wide">{label}</span>
    <textarea
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      className={cn(
        "w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 outline-none text-white text-sm resize-y transition focus:border-[#f97316]/40 placeholder:text-zinc-600",
        minH
      )}
    />
  </label>
);

const SelectInput: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; readOnly?: boolean }> = ({ label, value, onChange, options, readOnly }) => (
  <label className="block space-y-1.5">
    <span className="text-[11px] md:text-xs font-bold text-zinc-400 uppercase tracking-wide">{label}</span>
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={readOnly}
      className="w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 outline-none text-white text-sm transition appearance-none focus:border-[#22c55e]/40 disabled:opacity-60"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  </label>
);

const ChipSelect: React.FC<{ label: string; options: string[]; selected: string[]; onToggle: (v: string) => void; accent?: "green"|"orange"|"purple"; cols?: string; allowCustom?: boolean; onAddCustom?: (v: string) => void }> = ({
  label, options, selected, onToggle, accent = "orange", cols = "grid-cols-2 md:grid-cols-3", allowCustom, onAddCustom
}) => {
  const [showAdd, setShowAdd] = React.useState(false);
  const [custom, setCustom] = useState("");
  const borderSel = accent === "green"
    ? "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/40"
    : accent === "purple"
      ? "bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/40"
      : "bg-[#f97316]/10 text-[#f97316] border-[#f97316]/40";
  const all = useMemo(() => {
    const base = [...options];
    for (const s of selected) if (!base.includes(s)) base.push(s);
    return base;
  }, [options, selected]);

  const handleAdd = () => {
    const v = custom.trim();
    if (v && onAddCustom) { onAddCustom(v); setCustom(""); setShowAdd(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] md:text-xs font-bold text-zinc-400 uppercase tracking-wide">{label}</span>
        {allowCustom && (
          <button
            type="button"
            onClick={() => setShowAdd((s) => !s)}
            className="text-[11px] font-bold text-[#22c55e] hover:underline shrink-0 flex items-center gap-1 min-w-[44px] min-h-[28px]"
          >
            <Plus className="w-3.5 h-3.5" /> Novo
          </button>
        )}
      </div>
      {allowCustom && showAdd && (
        <div className="flex items-center gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Digite o novo valor..."
            className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-white/5 text-white text-sm outline-none focus:border-[#22c55e]/40"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
          />
          <button onClick={handleAdd} className="px-3 py-2 rounded-lg bg-[#22c55e] text-black text-xs font-bold min-w-[44px] min-h-[44px]">Adicionar</button>
        </div>
      )}
      <div className={cn("grid gap-2", cols)}>
        {all.map((opt) => {
          const isSel = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              className={cn(
                "w-full flex items-center px-3 py-2.5 rounded-xl border text-xs md:text-sm font-semibold transition min-h-[44px] text-left break-all",
                isSel ? borderSel : "bg-[#0d0d0d] text-zinc-400 border-white/5 hover:border-white/10 hover:text-zinc-200"
              )}
            >
              <span className={cn("w-4 h-4 rounded-md border mr-2 shrink-0 flex items-center justify-center",
                isSel ? (accent === "green" ? "bg-[#22c55e] border-[#22c55e]" : accent === "purple" ? "bg-[#a855f7] border-[#a855f7]" : "bg-[#f97316] border-[#f97316]") : "border-white/10"
              )}>
                {isSel && <CheckCircle2 className="w-3 h-3 text-black" />}
              </span>
              <span className="truncate">{opt}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const LevelBadge: React.FC<{ level: Level | null | undefined; size?: "sm" | "md" }> = ({ level, size = "sm" }) => {
  const idx = !level ? -1 : (["iniciante","basico","intermediario","intermediario_avancado","avancado"] as Level[]).indexOf(level as Level);
  const pct = idx < 0 ? 0 : Math.round(((idx + 1) / 5) * 100);
  const color = idx < 0 ? "#71717a"
    : idx <= 0 ? "#22c55e"
    : idx === 1 ? "#84cc16"
    : idx === 2 ? "#f97316"
    : idx === 3 ? "#f59e0b"
    : "#ef4444";
  const labelMap: Record<Level, string> = {
    iniciante: "Iniciante",
    basico: "Básico",
    intermediario: "Intermediário",
    intermediario_avancado: "Int/Avançado",
    avancado: "Avançado",
  };
  return (
    <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 border border-white/5", size === "md" ? "text-xs" : "text-[11px]")}>
      <div className="w-14 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-bold text-zinc-200">{!level ? "Não definido" : labelMap[level]}</span>
    </div>
  );
};

const StatCard: React.FC<{ icon: React.ReactNode; value: React.ReactNode; label: string; accent?: "green"|"orange"|"purple"|"zinc" }> = ({ icon, value, label, accent = "zinc" }) => {
  const c = accent === "green" ? "text-[#22c55e]" : accent === "orange" ? "text-[#f97316]" : accent === "purple" ? "text-[#a855f7]" : "text-zinc-400";
  return (
    <div className="flex items-center gap-3 p-3 md:p-4 rounded-2xl border border-white/5 bg-[#0d0d0d]">
      <div className={cn("w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center shrink-0 border border-white/5", c)}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-lg md:text-xl font-extrabold tracking-tight text-white leading-none">{value}</div>
        <div className="text-[11px] md:text-xs text-zinc-500 mt-0.5 truncate">{label}</div>
      </div>
    </div>
  );
};

const SkillLevelBadge: React.FC<{ level: SkillLevel }> = ({ level }) => {
  const cfg: Record<SkillLevel, { label: string; cls: string }> = {
    nao_iniciado:   { label: "Não iniciado", cls: "bg-zinc-900 text-zinc-500 border-white/10" },
    basico:         { label: "Básico",       cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
    em_desenvolvimento: { label: "Em desenvolvimento", cls: "bg-[#f97316]/10 text-[#f97316] border-[#f97316]/40" },
    dominado:       { label: "Dominado",     cls: "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/40" },
  };
  const c = cfg[level];
  return (
    <span className={cn("inline-flex items-center px-2 py-1 rounded-lg border text-[10px] font-bold whitespace-nowrap", c.cls)}>
      {c.label}
    </span>
  );
};

const SkillBar: React.FC<{ level: SkillLevel }> = ({ level }) => {
  const pct: Record<SkillLevel, number> = { nao_iniciado: 0, basico: 33, em_desenvolvimento: 66, dominado: 100 };
  const color: Record<SkillLevel, string> = { nao_iniciado: "#3f3f46", basico: "#60a5fa", em_desenvolvimento: "#f97316", dominado: "#22c55e" };
  return (
    <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden shrink-0">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct[level]}%`, background: color[level] }} />
    </div>
  );
};

const TagListReadOnly: React.FC<{ items: string[]; empty: string; accent?: "green"|"orange"|"purple" }> = ({ items, empty, accent = "green" }) => {
  if (!items || items.length === 0) return <div className="text-zinc-500 text-sm">{empty}</div>;
  const cls = accent === "green"
    ? "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20"
    : accent === "purple"
      ? "bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/20"
      : "bg-[#f97316]/10 text-[#f97316] border-[#f97316]/20";
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <span key={s} className={cn("px-2.5 py-1 rounded-lg border text-xs font-semibold", cls)}>{s}</span>
      ))}
    </div>
  );
};

// Input para lista simples string com chip removivel (ex: artistas, musicas, repertorio nome)
const StringChipList: React.FC<{ label: string; items: string[]; onChange: (next: string[]) => void; placeholder?: string; readOnly?: boolean; accent?: "green"|"orange"|"purple" }> = ({ label, items, onChange, placeholder, readOnly, accent = "orange" }) => {
  const [value, setValue] = useState("");
  const cls = accent === "green"
    ? "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/25"
    : accent === "purple"
      ? "bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/25"
      : "bg-[#f97316]/10 text-[#f97316] border-[#f97316]/25";
  const add = () => {
    const v = value.trim();
    if (!v) return;
    onChange([...(items || []), v]);
    setValue("");
  };
  if (readOnly) {
    if (!items || items.length === 0) return (
      <div className="space-y-1.5">
        <span className="block text-[11px] md:text-xs font-bold text-zinc-400 uppercase tracking-wide">{label}</span>
        <div className="text-zinc-500 text-sm p-3 rounded-xl bg-zinc-900/40 border border-white/5">Nenhum item cadastrado.</div>
      </div>
    );
    return (
      <div className="space-y-1.5">
        <span className="block text-[11px] md:text-xs font-bold text-zinc-400 uppercase tracking-wide">{label}</span>
        <div className="flex flex-wrap gap-2 p-3 rounded-xl bg-zinc-900/40 border border-white/5">
          {items.map((it) => (
            <span key={it} className={cn("px-3 py-1.5 rounded-xl border text-xs font-bold", cls)}>{it}</span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] md:text-xs font-bold text-zinc-400 uppercase tracking-wide">{label}</span>
      <div className="flex flex-wrap gap-2 p-3 rounded-xl bg-zinc-900/40 border border-white/5 min-h-[56px]">
        {items.map((it, idx) => (
          <span key={`${it}-${idx}`} className={cn("inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-bold", cls)}>
            {it}
            <button
              type="button"
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
              className="ml-1 w-4 h-4 rounded-full hover:bg-black/20 flex items-center justify-center shrink-0"
              aria-label={`Remover ${it}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <div className="flex-1 flex items-center gap-2 min-w-[180px]">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
            placeholder={placeholder || "Digite e pressione Enter..."}
            className="flex-1 bg-transparent outline-none text-white text-sm placeholder:text-zinc-600 py-1 px-2 rounded-lg hover:bg-white/5 min-w-[140px]"
          />
          <button
            type="button"
            onClick={add}
            className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center shrink-0 min-w-[44px] min-h-[44px]"
            aria-label="Adicionar"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Helpers Repertório (Nova integração Biblioteca ↔ Perfil)
// ============================================================
const LEVEL_BR: Record<string, string> = {
  iniciante: "Iniciante", basico: "Básico", intermediario: "Intermediário",
  intermediario_avancado: "Interm. Avançado", avancado: "Avançado",
};

function SongMiniInfo({ s }: { s: LibSong | null | undefined }) {
  if (!s) return <span className="text-[10px] text-zinc-500">Sem dados</span>;
  const parts = [
    s.main_style,
    s.level ? LEVEL_BR[s.level] || s.level : null,
    s.time_signature ? `${s.time_signature}` : null,
    (typeof s.chord_count === "number" && s.chord_count > 0) ? `${s.chord_count} ac.` : null,
  ].filter(Boolean) as string[];
  if (parts.length === 0) return <span className="text-[10px] text-zinc-500">Sem metadados</span>;
  return (
    <span className="text-[10px] md:text-[11px] text-zinc-400 tracking-tight truncate">
      {parts.join(" • ")}
    </span>
  );
}

// ============================================================
// Card de música no repertório do aluno
// ============================================================
interface RepCardProps {
  item: RepertoryItem;
  onOpenSong: (s: LibSong) => void;
  onChangeStatus: (songId: string, next: RepertoryStatus) => Promise<void> | void;
  onProgress: (songId: string, p: number) => Promise<void> | void;
  onObservation: (songId: string, obs: string) => Promise<void> | void;
  onRemove: (songId: string) => Promise<void> | void;
}
const RepertoryCard: React.FC<RepCardProps> = ({ item, onOpenSong, onChangeStatus, onProgress, onObservation, onRemove }) => {
  const s = item.song;
  const accent = STATUS_ACCENT_BG[item.status];
  const ring = STATUS_ACCENT_RING[item.status];
  const textC = STATUS_ACCENT_TEXT[item.status];
  const [openMenu, setOpenMenu] = useState(false);
  const [showProg, setShowProg] = useState(false);
  const [progVal, setProgVal] = useState(item.progresso);
  const [showObs, setShowObs] = useState(false);
  const [obsVal, setObsVal] = useState(item.observacao || "");
  const [menuRef] = useState(() => React.createRef<HTMLDivElement>());

  useEffect(() => { setProgVal(item.progresso); }, [item.progresso]);
  useEffect(() => { setObsVal(item.observacao || ""); }, [item.observacao]);
  useEffect(() => {
    if (!openMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openMenu, menuRef]);

  return (
    <div className={cn(
      "group rounded-2xl border border-white/5 bg-black/30 hover:bg-black/45 p-3 space-y-2 transition",
      "ring-1", ring,
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] md:text-[10px] font-bold text-black shrink-0", accent)}>
              {STATUS_LABEL[item.status]}
            </span>
            <button
              type="button"
              onClick={() => { if (s) onOpenSong(s); }}
              className="text-xs md:text-sm font-bold text-white truncate min-w-0 text-left hover:underline underline-offset-2"
              title="Ver detalhes da música na Biblioteca"
            >
              <Music2 className="w-3.5 h-3.5 inline mr-1 text-zinc-300" />
              {s?.title || `Música #${String(item.song_id).slice(0, 8)}`}
            </button>
          </div>
          {s?.artist ? (
            <div className="text-[11px] text-zinc-400 truncate">{s.artist}</div>
          ) : null}
          <div className="mt-1"><SongMiniInfo s={s} /></div>
        </div>
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpenMenu((o) => !o)}
            className="w-8 h-8 rounded-lg hover:bg-white/5 border border-white/5 flex items-center justify-center shrink-0 min-w-[44px] min-h-[44px]"
            aria-label="Ações"
          >
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          </button>
          {openMenu ? (
            <div className="absolute right-0 top-9 z-30 w-[190px] rounded-xl border border-white/10 bg-[#0d0d0d] shadow-2xl py-1.5 text-xs">
              <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Alterar status</div>
              {(["learning","mastered","planned"] as RepertoryStatus[]).map(st => (
                <button
                  key={st}
                  type="button"
                  disabled={item.status === st}
                  onClick={() => { setOpenMenu(false); void onChangeStatus(item.song_id, st); }}
                  className={cn(
                    "w-full text-left px-2.5 py-1.5 hover:bg-white/5 flex items-center justify-between disabled:opacity-40 disabled:hover:bg-transparent",
                    item.status === st ? "opacity-40" : ""
                  )}
                >
                  <span className={STATUS_ACCENT_TEXT[st]}>{STATUS_LABEL[st]}</span>
                  {item.status === st ? <CheckCircle2 className="w-3.5 h-3.5 text-zinc-500" /> : null}
                </button>
              ))}
              <div className="my-1 border-t border-white/5" />
              <button
                type="button"
                onClick={() => { setOpenMenu(false); setShowProg((v) => !v); }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-white/5 text-zinc-200 flex items-center gap-2"
              >
                <TrendingUp className="w-3.5 h-3.5" /> Progresso ({item.progresso}%)
              </button>
              <button
                type="button"
                onClick={() => { setOpenMenu(false); setShowObs((v) => !v); }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-white/5 text-zinc-200 flex items-center gap-2"
              >
                <BookMarked className="w-3.5 h-3.5" /> Observação
              </button>
              <div className="my-1 border-t border-white/5" />
              <button
                type="button"
                onClick={() => { setOpenMenu(false); if (s) onOpenSong(s); }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-white/5 text-zinc-200 flex items-center gap-2"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Ver música original
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpenMenu(false);
                  const ok = window.confirm(`Remover "${s?.title || "música"}" do repertório?`);
                  if (ok) void onRemove(item.song_id);
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-red-500/10 text-red-300 flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remover do repertório
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Progresso */}
      <div>
        <div className="flex items-center justify-between text-[10px] md:text-[11px] text-zinc-400 mb-1">
          <span className={textC}>Progresso</span>
          <span className="font-bold">{item.progresso}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden">
          <div className={cn("h-full transition-all", accent)} style={{ width: `${item.progresso}%` }} />
        </div>
        {showProg ? (
          <div className="mt-2 space-y-1.5 rounded-xl bg-black/25 border border-white/5 p-2">
            <div className="flex items-center gap-2">
              <input
                type="range" min={0} max={100} step={5}
                value={progVal}
                onChange={(e) => setProgVal(parseInt(e.target.value, 10))}
                className="flex-1 accent-orange-500"
              />
              <span className="w-9 text-right text-xs font-bold text-white">{progVal}%</span>
            </div>
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => { setShowProg(false); setProgVal(item.progresso); }}
                className="px-2.5 py-1 rounded-lg text-[11px] text-zinc-300 hover:bg-white/5 font-semibold"
              >Cancelar</button>
              <button
                type="button"
                onClick={() => { setShowProg(false); void onProgress(item.song_id, progVal); }}
                className={cn("px-2.5 py-1 rounded-lg text-[11px] text-black font-bold", accent)}
              >Salvar progresso</button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Observação */}
      {item.observacao && !showObs ? (
        <div className="rounded-xl border border-white/5 bg-black/25 p-2 text-[11px] md:text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap break-words">
          <span className={cn("font-bold mr-1", textC)}>Obs:</span>{item.observacao}
        </div>
      ) : null}
      {showObs ? (
        <div className="space-y-1.5 rounded-xl bg-black/25 border border-white/5 p-2">
          <textarea
            value={obsVal}
            onChange={(e) => setObsVal(e.target.value)}
            placeholder="Ex.: Aluno ainda apresenta dificuldade na troca de C para F."
            rows={2}
            className="w-full rounded-lg bg-black/40 border border-white/5 p-2 text-[11px] md:text-xs text-white outline-none resize-y min-h-[60px] placeholder:text-zinc-600"
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => { setShowObs(false); setObsVal(item.observacao || ""); }}
              className="px-2.5 py-1 rounded-lg text-[11px] text-zinc-300 hover:bg-white/5 font-semibold"
            >Cancelar</button>
            <button
              type="button"
              onClick={() => { setShowObs(false); void onObservation(item.song_id, obsVal); }}
              className={cn("px-2.5 py-1 rounded-lg text-[11px] text-black font-bold", accent)}
            >Salvar observação</button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

// ============================================================
// Coluna Repertório (3 colunas)
// ============================================================
interface RepColData { key: RepertoryStatus; title: string; accent: string; icon: React.ReactNode; items: RepertoryItem[] }
const RepertoryColumn: React.FC<{
  col: RepColData;
  actions: Pick<RepCardProps, "onOpenSong"|"onChangeStatus"|"onProgress"|"onObservation"|"onRemove">;
}> = ({ col, actions }) => {
  const colorMap: Record<string, string> = {
    orange: "border-[#f97316]/20 bg-[#f97316]/5",
    green:  "border-[#22c55e]/20 bg-[#22c55e]/5",
    purple: "border-[#a855f7]/20 bg-[#a855f7]/5",
  };
  const iconColor: Record<string, string> = {
    orange: "text-[#f97316] border-[#f97316]/30",
    green:  "text-[#22c55e] border-[#22c55e]/30",
    purple: "text-[#a855f7] border-[#a855f7]/30",
  };
  return (
    <div className={cn("rounded-2xl border p-3 space-y-2.5 h-full", colorMap[col.accent])}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center border bg-black/20",
            iconColor[col.accent]
          )}>{col.icon}</div>
          <div>
            <div className="text-xs font-bold text-white leading-tight">{col.title}</div>
            <div className="text-[10px] text-zinc-500">{col.items.length} {col.items.length === 1 ? "música" : "músicas"}</div>
          </div>
        </div>
      </div>
      {col.items.length === 0 ? (
        <div className="text-xs text-zinc-500 p-2 rounded-lg bg-black/10">Nenhuma música nesta lista.</div>
      ) : (
        <div className="space-y-2">
          {col.items.map((it) => (
            <RepertoryCard key={it.id || it.song_id} item={it} {...actions} />
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================
// Modal Ver Detalhe de Música (inline, usa dados hidratados)
// ============================================================
const SongDetailModal: React.FC<{
  open: boolean;
  onClose: () => void;
  song: LibSong | null;
}> = ({ open, onClose, song }) => {
  if (!open || !song) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 p-2 md:p-6 backdrop-blur-sm"
         onClick={onClose}>
      <div
        className="w-full max-w-[900px] max-h-[92vh] overflow-y-auto rounded-2xl md:rounded-3xl border border-white/10 bg-[#0d0d0d] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 md:px-6 py-4 border-b border-white/5 flex items-start justify-between gap-3 sticky top-0 bg-[#0d0d0d] z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1">
              <Music4 className="w-3 h-3" /> Biblioteca Musical
            </div>
            <h3 className="text-lg md:text-xl font-black text-white leading-tight break-words">
              {song.title || "Sem título"}
            </h3>
            {song.artist ? <div className="text-sm text-zinc-300 mt-0.5">{song.artist}</div> : null}
            <div className="mt-1.5"><SongMiniInfo s={song} /></div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl hover:bg-white/5 border border-white/10 flex items-center justify-center shrink-0 min-w-[44px] min-h-[44px]"
            aria-label="Fechar"
          >
            <X className="w-4 h-4 text-zinc-300" />
          </button>
        </div>
        <div className="px-4 md:px-6 py-4 md:py-5 space-y-4 md:space-y-5">
          {/* Ficha técnica */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            {[
              { k: "Nível", v: song.level ? LEVEL_BR[song.level] || song.level : "—" },
              { k: "Estilo", v: song.main_style || "—" },
              { k: "Sub-estilo", v: song.sub_style || "—" },
              { k: "Compasso", v: song.time_signature || "—" },
              { k: "BPM", v: song.bpm ?? "—" },
              { k: "Tom original", v: song.original_key || "—" },
              { k: "Acordes (qtd)", v: (song.chord_count ?? 0) || "—" },
              { k: "Ano", v: song.year || "—" },
            ].map((it) => (
              <div key={it.k} className="rounded-xl border border-white/5 bg-black/25 p-2.5">
                <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-zinc-500 font-bold">{it.k}</div>
                <div className="text-xs md:text-sm text-white font-bold mt-0.5 truncate">{String(it.v)}</div>
              </div>
            ))}
            {song.predominant_instrument ? (
              <div className="rounded-xl border border-white/5 bg-black/25 p-2.5 col-span-2 md:col-span-1">
                <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-zinc-500 font-bold">Instrumento principal</div>
                <div className="text-xs md:text-sm text-white font-bold mt-0.5 truncate">{song.predominant_instrument.name || "—"}</div>
              </div>
            ) : null}
          </div>
          {/* Instrumentos aplicáveis / Objetivos / Técnicas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
            {[
              { title: "Instrumentos aplicáveis", items: (song.applicable_instruments || []).map(x => x.name || "").filter(Boolean) as string[] },
              { title: "Objetivos pedagógicos", items: (song.objectives || []).map(x => x.name || "").filter(Boolean) as string[] },
              { title: "Técnicas trabalhadas", items: (song.techniques || []).map(x => x.name || "").filter(Boolean) as string[] },
            ].map(col => (
              <div key={col.title} className="rounded-xl border border-white/5 bg-black/25 p-3">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-bold mb-1.5">{col.title}</div>
                {col.items.length === 0 ? (
                  <div className="text-[11px] text-zinc-500">Não informado.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {col.items.map((n) => (
                      <span key={n} className="px-2 py-1 rounded-lg bg-white/5 border border-white/5 text-[11px] text-zinc-200 font-semibold">{n}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Chords + flags */}
          <div className="rounded-xl border border-white/5 bg-black/25 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-bold">Harmonia</div>
              <div className="flex flex-wrap gap-1">
                {song.has_barre_chord ? <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-red-500/15 text-red-300 border border-red-500/20">Tem pestana</span> : null}
                {song.has_7th_chords ? <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-orange-500/15 text-orange-300 border border-orange-500/20">Acordes 7ª</span> : null}
                {song.has_extended_chords ? <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/20">Acordes estendidos</span> : null}
              </div>
            </div>
            {song.chords_list && song.chords_list.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {song.chords_list.map(c => (
                  <span key={c} className="px-2 py-1 rounded-lg bg-[#f97316]/10 text-[#fdba74] border border-[#f97316]/30 font-bold text-[11px]">{c}</span>
                ))}
              </div>
            ) : <div className="text-[11px] text-zinc-500">Sem lista de acordes.</div>}
            {song.chords_text ? (
              <div className="mt-2 p-2.5 rounded-xl bg-black/30 border border-white/5 text-[11px] md:text-xs text-zinc-200 whitespace-pre-wrap break-words font-mono leading-relaxed">
                {song.chords_text}
              </div>
            ) : null}
          </div>
          {/* Cifra / Letra */}
          {song.lyrics_chords ? (
            <div className="rounded-xl border border-white/5 bg-black/25 p-3">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-bold mb-1.5">Cifra / Letra</div>
              <div className="p-2.5 rounded-xl bg-black/30 border border-white/5 text-[11px] md:text-xs text-zinc-200 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-[40vh] overflow-y-auto">
                {song.lyrics_chords}
              </div>
            </div>
          ) : null}
          {/* Descrição */}
          {song.description ? (
            <div className="rounded-xl border border-white/5 bg-black/25 p-3 text-xs md:text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-bold mb-1">Descrição / observações pedagógicas</div>
              {song.description}
            </div>
          ) : null}
          {/* YouTube */}
          {song.listen_url ? (
            <div className="rounded-xl border border-[#ef4444]/30 bg-[#ef4444]/5 p-3 flex items-start md:items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-zinc-400 font-bold mb-0.5">Referência de áudio / vídeo</div>
                <a href={song.listen_url} target="_blank" rel="noreferrer" className="text-white font-bold hover:underline break-all text-xs md:text-sm">{song.listen_url}</a>
              </div>
              <a href={song.listen_url} target="_blank" rel="noreferrer"
                 className="px-3 py-2 rounded-xl bg-gradient-to-r from-[#ef4444] to-[#b91c1c] text-white text-xs font-bold flex items-center gap-2 shrink-0">
                <Play className="w-3.5 h-3.5" /> Abrir referência
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================
interface Props {
  studentId: string;
  studentName: string;
}

export default function StudentMusicProfile({ studentId, studentName }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [profile, setProfile] = useState<MusicProfile>({ ...EMPTY_PROFILE, preferences: { ...EMPTY_PROFILE.preferences }, repertory: { ...EMPTY_PROFILE.repertory }, skills: {} });

  // ============================================================
  // NOVOS ESTADOS — Integração Repertório ↔ Biblioteca Musical
  // ============================================================
  const [repertoryItems, setRepertoryItems] = useState<RepertoryItem[]>([]);
  const [repertoryLoading, setRepertoryLoading] = useState(false);

  // Modal: Ver detalhe música original
  const [songDetailOpen, setSongDetailOpen] = useState(false);
  const [songDetailSong, setSongDetailSong] = useState<LibSong | null>(null);

  // Modal: + Adicionar música (busca + filtros reutilizando GET /admin/music/songs)
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addFilters, setAddFilters] = useState<{
    instrument_id: string; level: string; main_style: string; time_signature: string;
    objective_id: string; technique_id: string; max_chords: string;
  }>({ instrument_id: "", level: "", main_style: "", time_signature: "", objective_id: "", technique_id: "", max_chords: "" });
  const [addFiltersOpen, setAddFiltersOpen] = useState(false);
  const [addResults, setAddResults] = useState<LibSong[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const [addCatalogs, setAddCatalogs] = useState<{instruments: any[]; objectives: any[]; techniques: any[]; styles: string[]}>({ instruments: [], objectives: [], techniques: [], styles: [] });

  // Modal: ✨ Sugerir músicas (scoring 0..100, mostra 94/100)
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestList, setSuggestList] = useState<Suggestion[]>([]);

  // Diálogo: escolher status antes de adicionar (default: planned = Próxima)
  const [pendingAdd, setPendingAdd] = useState<{ song: LibSong; fromSuggestion?: boolean } | null>(null);
  const [pendingStatus, setPendingStatus] = useState<RepertoryStatus>("planned");
  const [savingAdd, setSavingAdd] = useState(false);

  // ------------ LOAD ------------
  const loadRepertory = async () => {
    setRepertoryLoading(true);
    try {
      const res = await apiFetch(`/admin/students/${studentId}/repertory`, { method: "GET" },
        { throwOnError: false, jsonBody: true });
      if (res && (res as any).ok) {
        const data = await (res as any).json().catch(() => ({ items: [] }));
        setRepertoryItems(Array.isArray(data?.items) ? data.items : []);
      }
    } finally {
      setRepertoryLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [profileRes] = await Promise.all([
        apiFetch(`/admin/students/${studentId}/music-profile`, { method: "GET" },
          { prefix: "Erro ao carregar Perfil Musical", throwOnError: false, jsonBody: true }),
        // Fire-and-forget do repertório para não bloquear o resto
        (async () => { try { await loadRepertory(); } catch {} })(),
      ]);
      if (profileRes && (profileRes as any).ok) {
        const data = await (profileRes as any).json().catch(() => ({ profile: null }));
        if (data?.profile) setProfile({ ...EMPTY_PROFILE, ...data.profile });
      }
    } finally {
      setLoading(false);
    }
  };

  // ------------ Persistência Rascunho (existente) ------------
  const readonly = !isEditing;

  // ================= PERSISTÊNCIA DE RASCUNHO (Perfil Musical) =================
  // Salvar rascunho sempre que estiver editando (isEditing=true) e profile mudar.
  useEffect(() => {
    if (!isEditing) return;
    const draft: StudentProfileDraft = {
      saved_at_ms: Date.now(),
      profile: JSON.parse(JSON.stringify(profile)),
    };
    saveSpDraft(studentId, draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, isEditing, profile]);

  // Restaurar rascunho APENAS quando carregamento inicial terminar,
  // e de forma não-destrutiva: só aplica se estiver vazio vs saved profile
  // e mostra um banner pedindo confirmação.
  const spDraftRef = useRef<StudentProfileDraft | null>(null);
  const [spRestoreOpen, setSpRestoreOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (spDraftRef.current) return;
    const d = loadSpDraft(studentId);
    if (!d) return;
    // Frescor (< 7 dias)
    if (Date.now() - (d.saved_at_ms || 0) > 7 * 24 * 3600 * 1000) {
      clearSpDraft(studentId);
      return;
    }
    spDraftRef.current = d;
    setSpRestoreOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, loading]);

  const applySpDraft = () => {
    const d = spDraftRef.current;
    if (!d) { setSpRestoreOpen(false); return; }
    setProfile({
      ...EMPTY_PROFILE,
      ...(d.profile || {}),
      preferences: { ...EMPTY_PROFILE.preferences, ...((d.profile as any)?.preferences || {}) },
      repertory: { ...EMPTY_PROFILE.repertory, ...((d.profile as any)?.repertory || {}) },
      skills: ((d.profile as any)?.skills) || {},
    });
    setIsEditing(true);
    spDraftRef.current = null;
    setSpRestoreOpen(false);
  };
  const dismissSpDraft = () => {
    clearSpDraft(studentId);
    spDraftRef.current = null;
    setSpRestoreOpen(false);
  };

  // Ao salvar ou cancelar edição: limpa o rascunho.
  useEffect(() => {
    if (isEditing === false && !saving && !loading) {
      // Não limpa imediatamente — se o usuário entrar novamente, preferimos manter.
      // Limpamos apenas no save explicitamente.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  // Confirm beforeunload/pagehide se tiver draft NÃO SALVO.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: BeforeUnloadEvent) => {
      const hasDraft = !!loadSpDraft(studentId);
      if (hasDraft) {
        e.preventDefault();
        // eslint-disable-next-line no-param-reassign
        e.returnValue = "Você tem alterações não salvas no Perfil Musical. Deseja sair mesmo assim?";
        return e.returnValue;
      }
      return undefined;
    };
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pagehide", handler as any);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", handler as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  // ------------ Helpers Repertório ------------
  const addByStatusAndClosePending = async () => {
    if (!pendingAdd?.song?.id) { setPendingAdd(null); setSavingAdd(false); return; }
    setSavingAdd(true);
    try {
      const body = JSON.stringify({ song_id: pendingAdd.song.id, status: pendingStatus });
      const res = await apiFetch(`/admin/students/${studentId}/repertory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }, { throwOnError: false, jsonBody: true, prefix: "Erro ao adicionar música" });

      const isOk = res && (res as any).ok;
      let detailRaw: any = null;
      if (!isOk) {
        try { detailRaw = await (res as any).json(); } catch {}
      }

      if (!isOk && (res as any).status === 409 && detailRaw?.detail?.already_exists) {
        // Item 6: já existe. Oferece alterar status ou abrir.
        const cur = detailRaw.detail.current_status || "planned";
        const op = window.confirm(
          `Esta música já está no repertório deste aluno como "${STATUS_LABEL[cur as RepertoryStatus] || cur}".\n\n` +
          `Clique OK para ALTERAR para "${STATUS_LABEL[pendingStatus]}"\n` +
          `Clique Cancelar para apenas ABRIR os detalhes.`
        );
        if (op) {
          await patchRepertoryInternal(pendingAdd.song.id, { status: pendingStatus });
        } else {
          setSongDetailSong(pendingAdd.song); setSongDetailOpen(true);
        }
      } else if (isOk) {
        // Atualiza UI
        await loadRepertory();
        if (pendingAdd.fromSuggestion) {
          // Remove da lista de sugestões localmente (evita duplica)
          setSuggestList(prev => prev.filter(s => s.song.id !== pendingAdd.song.id));
        }
        // Fechar modal "adicionar" após sucesso (não fecha para poder adicionar mais de uma,
        // mas vamos limpar a seleção).
      } else if (detailRaw?.detail) {
        alert(`Erro ao adicionar: ${JSON.stringify(detailRaw.detail)}`);
      } else {
        alert("Erro ao adicionar música ao repertório.");
      }
    } finally {
      setSavingAdd(false);
      setPendingAdd(null);
      setPendingStatus("planned");
    }
  };

  const patchRepertoryInternal = async (songId: string, patch: { status?: RepertoryStatus; progresso?: number; observacao?: string }) => {
    const res = await apiFetch(`/admin/students/${studentId}/repertory/${songId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }, { throwOnError: false, jsonBody: true, prefix: "Erro ao atualizar repertório" });
    if (res && (res as any).ok) await loadRepertory();
  };

  const changeStatusRep = async (songId: string, next: RepertoryStatus) => patchRepertoryInternal(songId, { status: next });
  const changeProgressRep = async (songId: string, p: number) => patchRepertoryInternal(songId, { progresso: p });
  const changeObservationRep = async (songId: string, obs: string) => patchRepertoryInternal(songId, { observacao: obs });
  const removeRep = async (songId: string) => {
    const res = await apiFetch(`/admin/students/${studentId}/repertory/${songId}`, { method: "DELETE" },
      { throwOnError: false, jsonBody: true });
    if (res && (res as any).ok) await loadRepertory();
  };

  const openSong = (s: LibSong) => { setSongDetailSong(s); setSongDetailOpen(true); };

  // ------------ Add Música: busca + filtros (reutiliza GET /admin/music/songs) ------------
  const addDebRef = useRef<any>(null);
  const runAddSearch = async () => {
    setAddSearching(true);
    try {
      const params = new URLSearchParams();
      if (addSearch.trim()) params.set("search", addSearch.trim());
      if (addFilters.instrument_id) params.set("instrument_id", addFilters.instrument_id);
      if (addFilters.level) params.set("level", addFilters.level);
      if (addFilters.main_style) params.set("main_style", addFilters.main_style);
      if (addFilters.time_signature) params.set("time_signature", addFilters.time_signature);
      if (addFilters.objective_id) params.set("objective_id", addFilters.objective_id);
      if (addFilters.technique_id) params.set("technique_id", addFilters.technique_id);
      const mc = parseInt(addFilters.max_chords, 10);
      if (!Number.isNaN(mc) && mc > 0) params.set("max_chords", String(mc));
      const res = await apiFetch(`/admin/music/songs?${params.toString()}`, { method: "GET" },
        { jsonBody: true, throwOnError: false });
      if (res && (res as any).ok) {
        const data = await (res as any).json().catch(() => ({ songs: [] }));
        setAddResults(Array.isArray(data?.songs) ? data.songs : []);
      } else {
        setAddResults([]);
      }
    } finally {
      setAddSearching(false);
    }
  };

  useEffect(() => {
    if (!addOpen) return;
    // Carregar filtros catálogos (1x ao abrir o modal)
    if (addCatalogs.instruments.length === 0) {
      (async () => {
        try {
          const res = await apiFetch(`/admin/music/catalogs`, { method: "GET" },
            { jsonBody: true, throwOnError: false });
          if (res && (res as any).ok) {
            const d = await (res as any).json().catch(() => ({}));
            setAddCatalogs({
              instruments: Array.isArray(d?.instruments) ? d.instruments : [],
              objectives: Array.isArray(d?.objectives) ? d.objectives : [],
              techniques: Array.isArray(d?.techniques) ? d.techniques : [],
              styles: Array.isArray(d?.styles) ? d.styles : [],
            });
          }
        } catch {}
      })();
    }
    // Load inicial (resultado geral)
    setAddResults([]);
    void runAddSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addOpen]);

  // Busca debounced
  useEffect(() => {
    if (!addOpen) return;
    if (addDebRef.current) window.clearTimeout(addDebRef.current);
    addDebRef.current = window.setTimeout(() => void runAddSearch(), 220);
    return () => { if (addDebRef.current) window.clearTimeout(addDebRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addOpen, addSearch, addFilters.instrument_id, addFilters.level, addFilters.main_style, addFilters.time_signature, addFilters.objective_id, addFilters.technique_id, addFilters.max_chords]);

  // ------------ Sugestões ------------
  const loadSuggestions = async () => {
    setSuggestLoading(true);
    try {
      const res = await apiFetch(`/admin/students/${studentId}/repertory/suggestions?limit=30`, { method: "GET" },
        { jsonBody: true, throwOnError: false });
      if (res && (res as any).ok) {
        const d = await (res as any).json().catch(() => ({ suggestions: [] }));
        setSuggestList(Array.isArray(d?.suggestions) ? d.suggestions : []);
      } else setSuggestList([]);
    } finally {
      setSuggestLoading(false);
    }
  };
  useEffect(() => {
    if (suggestOpen) void loadSuggestions();
    else setSuggestList([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestOpen]);

  // ------------ Save Perfil ------------
  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {
        main_instrument: profile.main_instrument,
        other_instruments: profile.other_instruments,
        level: profile.level,
        experience_text: profile.experience_text,
        styles: profile.styles,
        objectives: profile.objectives,
        main_objective: profile.main_objective,
        difficulties: profile.difficulties,
        observations: profile.observations,
        skills: profile.skills,
        preferences: profile.preferences,
        repertory: profile.repertory,
      };
      const res = await apiFetch(`/admin/students/${studentId}/music-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, { prefix: "Erro ao salvar Perfil Musical", jsonBody: true, throwOnError: false });
      if (res && (res as any).ok) {
        const data = await (res as any).json().catch(() => ({ profile: null }));
        if (data?.profile) {
          setProfile({ ...EMPTY_PROFILE, ...data.profile });
        }
        clearSpDraft(studentId);
        setIsEditing(false);
        alert("✅ Perfil Musical salvo com sucesso!");
      }
    } finally {
      setSaving(false);
    }
  };

  // ================= HELPERS de set =================
  const setP = <K extends keyof MusicProfile>(k: K, v: MusicProfile[K]) =>
    setProfile((prev) => ({ ...prev, [k]: v }));
  const toggleInList = (k: keyof Pick<MusicProfile,"styles"|"objectives"|"difficulties"|"other_instruments">, value: string) => {
    const cur = (profile[k] as any as string[]) || [];
    setP(k, (cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]) as any);
  };
  const setSkill = (cat: string, skill: string, level: SkillLevel) => {
    setProfile((prev) => ({
      ...prev,
      skills: {
        ...(prev.skills || {}),
        [cat]: { ...((prev.skills || {})[cat] || {}), [skill]: level }
      }
    }));
  };
  const getSkill = (cat: string, skill: string): SkillLevel => (profile.skills?.[cat]?.[skill] as SkillLevel) || "nao_iniciado";
  const setPref = <K extends keyof MusicProfile["preferences"]>(k: K, v: MusicProfile["preferences"][K]) => {
    setProfile((prev) => ({ ...prev, preferences: { ...(prev.preferences || EMPTY_PROFILE.preferences), [k]: v } }));
  };

  // ================= Estatísticas do resumo (cálculo automático) =================
  const stats = useMemo(() => {
    return {
      mastered:  repertoryItems.filter(r => r.status === "mastered").length,
      learning:  repertoryItems.filter(r => r.status === "learning").length,
      planned:   repertoryItems.filter(r => r.status === "planned").length,
    };
  }, [repertoryItems]);

  const mainStyle = (profile.styles && profile.styles[0]) || "—";

  // ================= RENDER =================
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm p-10">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-zinc-700 border-t-[#22c55e] rounded-full animate-spin" />
          Carregando Perfil Musical...
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full min-h-0 overflow-y-auto bg-[#050505]"
         style={{ WebkitOverflowScrolling: "touch" as any, touchAction: "pan-y" }}>
      <div className="px-4 md:px-8 py-4 md:py-6 space-y-5 max-w-[1500px] mx-auto">

        {/* ====== Banner: rascunho de perfil recuperado ====== */}
        {spRestoreOpen && (
          <div className="px-3 py-2.5 rounded-xl border border-[#22c55e]/30 bg-gradient-to-r from-[#22c55e]/10 via-[#f59e0b]/5 to-transparent text-[12px] md:text-sm text-[#bbf7d0] flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div className="flex items-start md:items-center gap-2">
              <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-[#22c55e] shrink-0 mt-0.5 md:mt-0" />
              <div className="leading-snug">
                <span className="font-bold text-[#86efac]">Rascunho recuperado:</span>{" "}
                Você tinha alterações não salvas neste perfil.
                {" "}
                {spDraftRef.current?.saved_at_ms ? (
                  <span className="text-[#86efac]/80 text-[11px]">
                    (salvo em {new Date(spDraftRef.current.saved_at_ms).toLocaleString("pt-BR")})
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={dismissSpDraft}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] md:text-xs font-semibold transition"
              >
                Descartar
              </button>
              <button
                onClick={applySpDraft}
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-black text-[11px] md:text-xs font-bold transition active:scale-[0.98]"
              >
                Restaurar alterações
              </button>
            </div>
          </div>
        )}

        {/* ============= RESUMO TOPO ============= */}
        <div className={cn(
          "rounded-3xl border border-white/5 overflow-hidden",
          "bg-gradient-to-br from-[#0d0d0d] via-[#0a0a0a] to-[#0d0d0d]"
        )}>
          {/* Faixa decorativa superior gradient */}
          <div className="h-1.5 w-full bg-gradient-to-r from-[#22c55e] via-[#f97316] to-[#a855f7]" />
          <div className="p-4 md:p-6 space-y-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-start md:items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#22c55e]/20 via-[#f97316]/20 to-[#a855f7]/20 border border-white/10 flex items-center justify-center shrink-0">
                  <Music4 className="w-7 h-7 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-[10px] md:text-[11px] uppercase tracking-[0.15em] font-extrabold bg-gradient-to-r from-[#22c55e] to-[#f97316] bg-clip-text text-transparent">Perfil Musical</span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-[10px] text-zinc-500 font-bold">ID do aluno: {studentId.slice(0,8)}...</span>
                  </div>
                  <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight leading-tight truncate">
                    {studentName}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/20 text-[#22c55e] text-[11px] font-bold">
                      <Guitar className="w-3.5 h-3.5" /> {profile.main_instrument || "Instrumento principal não definido"}
                    </div>
                    <LevelBadge level={profile.level} />
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#a855f7]/10 border border-[#a855f7]/20 text-[#a855f7] text-[11px] font-bold">
                      <Sparkles className="w-3.5 h-3.5" /> Estilo: {mainStyle}
                    </div>
                  </div>
                  {profile.main_objective && (
                    <div className="mt-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                      <div className="text-[10px] uppercase tracking-widest font-extrabold text-[#f97316] mb-1 flex items-center gap-1.5">
                        <Target className="w-3 h-3" /> Objetivo principal
                      </div>
                      <div className="text-sm text-zinc-300 leading-relaxed break-words">{profile.main_objective}</div>
                    </div>
                  )}
                </div>
              </div>
              {/* Botões Editar / Salvar */}
              <div className="flex items-center gap-2 shrink-0">
                {readonly ? (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-bold border border-white/10 transition min-h-[48px] min-w-[48px] active:scale-[0.98]"
                  >
                    <Edit3 className="w-4 h-4" /> Editar Perfil
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => { setIsEditing(false); void load(); }}
                      className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-sm font-bold border border-white/10 transition min-h-[48px]"
                      disabled={saving}
                    >
                      <X className="w-4 h-4" /> Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#16a34a] hover:brightness-110 text-black text-sm font-extrabold shadow-[0_0_20px_rgba(34,197,94,0.25)] transition min-h-[48px] disabled:opacity-60 active:scale-[0.98]"
                    >
                      {saving ? (
                        <>
                          <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" /> Salvar Alterações
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={<ClockIcon className="w-5 h-5" />}
                value={<span className="truncate inline-block max-w-[13ch]">{profile.experience_text || "—"}</span>}
                label="Experiência" accent="orange" />
              <StatCard icon={<Award className="w-5 h-5" />}
                value={stats.mastered}
                label="Músicas dominadas" accent="green" />
              <StatCard icon={<Play className="w-5 h-5" />}
                value={stats.learning}
                label="Músicas aprendendo" accent="orange" />
              <StatCard icon={<BookMarked className="w-5 h-5" />}
                value={stats.planned}
                label="Músicas planejadas" accent="purple" />
            </div>
          </div>
        </div>

        {/* ============= SEÇÕES ============= */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">

          {/* COLUNA ESQUERDA */}
          <div className="space-y-4 md:space-y-5">

            {/* 1. Informacoes musicais */}
            <div className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-4 md:p-5">
              <SectionHeader title="Informações Musicais" icon={<Music2 className="w-5 h-5" />} sub="Instrumento, nível e experiência" accent="green" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <SelectInput
                  label="Instrumento principal"
                  value={profile.main_instrument || ""}
                  onChange={(v) => setP("main_instrument", v || null)}
                  options={[{ value: "", label: "Selecione..." }, ...INSTRUMENTS.map((i) => ({ value: i, label: i }))]}
                  readOnly={readonly}
                />
                <TextInput
                  label="Tempo de experiência"
                  value={profile.experience_text || ""}
                  onChange={(v) => setP("experience_text", v || null)}
                  placeholder="Ex: 2 anos e 6 meses"
                  readOnly={readonly}
                />
                <SelectInput
                  label="Nível musical"
                  value={profile.level || ""}
                  onChange={(v) => setP("level", (v || null) as any)}
                  options={LEVELS}
                  readOnly={readonly}
                />
                <ChipSelect
                  label="Outros instrumentos"
                  options={INSTRUMENTS.filter((i) => i !== profile.main_instrument)}
                  selected={profile.other_instruments || []}
                  onToggle={(v) => toggleInList("other_instruments", v)}
                  accent="green"
                  cols="grid-cols-2"
                  allowCustom={!readonly}
                  onAddCustom={readonly ? undefined : (v) => setP("other_instruments", [...(profile.other_instruments || []), v])}
                />
              </div>
            </div>

            {/* 2. Estilos musicais */}
            <div className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-4 md:p-5">
              <SectionHeader title="Estilos Musicais" icon={<Star className="w-5 h-5" />} sub="Selecione todos que se aplicam" accent="purple" />
              {readonly ? (
                <TagListReadOnly items={profile.styles} empty="Nenhum estilo selecionado." accent="purple" />
              ) : (
                <ChipSelect
                  label="Estilos"
                  options={STYLE_OPTIONS}
                  selected={profile.styles}
                  onToggle={(v) => toggleInList("styles", v)}
                  accent="purple"
                  cols="grid-cols-2 md:grid-cols-3"
                  allowCustom
                  onAddCustom={(v) => setP("styles", [...profile.styles, v])}
                />
              )}
            </div>

            {/* 3. Objetivos musicais */}
            <div className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-4 md:p-5">
              <SectionHeader title="Objetivos Musicais" icon={<Target className="w-5 h-5" />} sub="Objetivos listados + objetivo principal livre" accent="orange" />
              <div className="space-y-4">
                {readonly ? (
                  <TagListReadOnly items={profile.objectives} empty="Nenhum objetivo selecionado." accent="orange" />
                ) : (
                  <ChipSelect
                    label="Objetivos do aluno"
                    options={OBJECTIVE_OPTIONS}
                    selected={profile.objectives}
                    onToggle={(v) => toggleInList("objectives", v)}
                    accent="orange"
                    cols="grid-cols-2 md:grid-cols-3"
                    allowCustom
                    onAddCustom={(v) => setP("objectives", [...profile.objectives, v])}
                  />
                )}
                <TextArea
                  label="Objetivo principal (livre)"
                  value={profile.main_objective || ""}
                  onChange={(v) => setP("main_objective", v || null)}
                  placeholder="Ex: Quero conseguir acompanhar músicas gospel no violão sem precisar consultar cifras."
                  minH="min-h-[90px]"
                  readOnly={readonly}
                />
              </div>
            </div>

            {/* 6. Preferencias musicais */}
            <div className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-4 md:p-5">
              <SectionHeader title="Preferências Musicais" icon={<Headphones className="w-5 h-5" />} sub="Artistas, músicas favoritas e desejadas" accent="orange" />
              <div className="grid grid-cols-1 gap-4">
                <StringChipList
                  label="Artistas / Bandas favoritos"
                  items={profile.preferences?.favorite_artists ?? []}
                  onChange={(v) => setPref("favorite_artists", v)}
                  placeholder="Ex: Isaias Saad"
                  readOnly={readonly}
                  accent="purple"
                />
                <StringChipList
                  label="Músicas favoritas"
                  items={profile.preferences?.favorite_songs ?? []}
                  onChange={(v) => setPref("favorite_songs", v)}
                  placeholder="Ex: Ousado Amor"
                  readOnly={readonly}
                  accent="orange"
                />
                {readonly ? (
                  <div className="space-y-1.5">
                    <span className="block text-[11px] md:text-xs font-bold text-zinc-400 uppercase tracking-wide">Estilos favoritos</span>
                    <TagListReadOnly items={profile.preferences?.favorite_styles ?? []} empty="Nenhum estilo selecionado." accent="purple" />
                  </div>
                ) : (
                  <ChipSelect
                    label="Estilos favoritos"
                    options={[...STYLE_OPTIONS, ...(profile.styles || [])].filter((x, i, a) => a.indexOf(x) === i)}
                    selected={profile.preferences?.favorite_styles ?? []}
                    onToggle={(v) => setPref("favorite_styles", ((profile.preferences?.favorite_styles ?? []).includes(v)
                      ? (profile.preferences?.favorite_styles ?? []).filter((x) => x !== v)
                      : [...(profile.preferences?.favorite_styles ?? []), v]
                    ))}
                    accent="purple"
                    cols="grid-cols-2 md:grid-cols-3"
                    allowCustom
                    onAddCustom={(v) => setPref("favorite_styles", [...(profile.preferences?.favorite_styles ?? []), v])}
                  />
                )}
                <StringChipList
                  label="Músicas que gostaria de aprender"
                  items={profile.preferences?.want_to_learn ?? []}
                  onChange={(v) => setPref("want_to_learn", v)}
                  placeholder="Ex: Me atraiu"
                  readOnly={readonly}
                  accent="green"
                />
              </div>
            </div>

          </div>

          {/* COLUNA DIREITA */}
          <div className="space-y-4 md:space-y-5">

            {/* 4. Habilidades (3 categorias / 4 níveis) */}
            <div className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-4 md:p-5">
              <SectionHeader title="Habilidades" icon={<Zap className="w-5 h-5" />} sub="Técnica • Ritmo • Teoria (4 níveis cada)" accent="green" />
              <div className="space-y-5">
                {SKILL_CATEGORIES.map((cat) => (
                  <div key={cat.key} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center border",
                        cat.accent === "green" ? "text-[#22c55e] border-[#22c55e]/30 bg-[#22c55e]/5"
                        : cat.accent === "orange" ? "text-[#f97316] border-[#f97316]/30 bg-[#f97316]/5"
                        : "text-[#a855f7] border-[#a855f7]/30 bg-[#a855f7]/5"
                      )}>
                        <TrendingUp className="w-4 h-4" />
                      </div>
                      <span className="text-sm font-extrabold text-white">{cat.label}</span>
                    </div>
                    <div className="space-y-1.5">
                      {cat.skills.map((sk) => {
                        const lv = getSkill(cat.key, sk.key);
                        if (readonly) {
                          return (
                            <div key={sk.key} className="grid grid-cols-12 items-center gap-2 py-1.5 px-2 rounded-xl hover:bg-white/[0.02]">
                              <div className="col-span-5 md:col-span-4 text-xs md:text-sm text-zinc-200 font-semibold truncate min-w-0">{sk.label}</div>
                              <div className="col-span-4 md:col-span-5"><SkillBar level={lv} /></div>
                              <div className="col-span-3 text-right"><SkillLevelBadge level={lv} /></div>
                            </div>
                          );
                        }
                        return (
                          <div key={sk.key} className="grid grid-cols-12 items-center gap-2 py-1.5 px-2 rounded-xl hover:bg-white/[0.02]">
                            <div className="col-span-12 md:col-span-4 text-xs md:text-sm text-zinc-200 font-semibold truncate min-w-0">{sk.label}</div>
                            <div className="col-span-12 md:col-span-8 flex flex-wrap md:flex-nowrap items-stretch gap-1 p-1 rounded-xl bg-black/25 border border-white/5">
                              {SKILL_LEVELS.map((opt) => {
                                const sel = lv === opt.value;
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setSkill(cat.key, sk.key, opt.value)}
                                    className={cn(
                                      "flex-1 px-2 py-2 rounded-lg text-[11px] font-bold transition whitespace-nowrap min-h-[36px]",
                                      sel ? (
                                        opt.value === "dominado" ? "bg-[#22c55e] text-black"
                                        : opt.value === "em_desenvolvimento" ? "bg-[#f97316] text-black"
                                        : opt.value === "basico" ? "bg-blue-500 text-white"
                                        : "bg-zinc-700 text-white"
                                      ) : "text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
                                    )}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 5. Principais Dificuldades + Observações */}
            <div className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-4 md:p-5">
              <SectionHeader title="Principais Dificuldades" icon={<ChevronDown className="w-5 h-5" />} sub="O que o aluno mais tem dificuldade" accent="orange" />
              <div className="space-y-4">
                {readonly ? (
                  <TagListReadOnly items={profile.difficulties} empty="Nenhuma dificuldade marcada." accent="orange" />
                ) : (
                  <ChipSelect
                    label="Selecione as dificuldades"
                    options={DIFFICULTY_OPTIONS}
                    selected={profile.difficulties}
                    onToggle={(v) => toggleInList("difficulties", v)}
                    accent="orange"
                    cols="grid-cols-2 md:grid-cols-3"
                    allowCustom
                    onAddCustom={(v) => setP("difficulties", [...profile.difficulties, v])}
                  />
                )}
                <TextArea
                  label="Observações do professor"
                  value={profile.observations || ""}
                  onChange={(v) => setP("observations", v || null)}
                  placeholder="Ex: Tem dificuldade principalmente na troca entre F e C. Executa os acordes individualmente, mas perde o tempo durante a troca."
                  minH="min-h-[120px]"
                  readOnly={readonly}
                />
              </div>
            </div>

            {/* 7. Repertório (3 colunas com integração Biblioteca Musical ↔ Perfil Musical) */}
            <div className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-4 md:p-5 space-y-4">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <SectionHeader title="🎶 Repertório do Aluno" icon={<BookOpen className="w-5 h-5" />} sub="Vinculado diretamente à Biblioteca Musical (song_id — sem duplicação)" accent="purple" />
                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                  <button
                    type="button"
                    onClick={() => setAddOpen(true)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white text-xs md:text-sm font-bold shadow-lg active:scale-[0.98] transition"
                  >
                    <Plus className="w-4 h-4" /> Adicionar música
                  </button>
                  <button
                    type="button"
                    onClick={() => setSuggestOpen(true)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-[#22c55e] via-[#10b981] to-[#0ea5e9] text-black text-xs md:text-sm font-bold shadow-lg active:scale-[0.98] transition"
                  >
                    <Sparkles className="w-4 h-4" /> Sugerir músicas para este aluno
                  </button>
                </div>
              </div>

              {repertoryLoading ? (
                <div className="text-xs text-zinc-400 p-3 rounded-xl bg-black/30 border border-white/5">🔄 Carregando repertório...</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <RepertoryColumn
                    col={{
                      key: "learning", title: "🟡 Aprendendo", accent: "orange",
                      icon: <Play className="w-4 h-4" />,
                      items: repertoryItems.filter(r => r.status === "learning"),
                    }}
                    actions={{ onOpenSong: openSong, onChangeStatus: changeStatusRep, onProgress: changeProgressRep, onObservation: changeObservationRep, onRemove: removeRep }}
                  />
                  <RepertoryColumn
                    col={{
                      key: "mastered", title: "🟢 Dominadas", accent: "green",
                      icon: <Award className="w-4 h-4" />,
                      items: repertoryItems.filter(r => r.status === "mastered"),
                    }}
                    actions={{ onOpenSong: openSong, onChangeStatus: changeStatusRep, onProgress: changeProgressRep, onObservation: changeObservationRep, onRemove: removeRep }}
                  />
                  <RepertoryColumn
                    col={{
                      key: "planned", title: "🔵 Próximas", accent: "purple",
                      icon: <BookMarked className="w-4 h-4" />,
                      items: repertoryItems.filter(r => r.status === "planned"),
                    }}
                    actions={{ onOpenSong: openSong, onChangeStatus: changeStatusRep, onProgress: changeProgressRep, onObservation: changeObservationRep, onRemove: removeRep }}
                  />
                </div>
              )}

              <p className="text-[11px] text-zinc-500 leading-relaxed">
                📌 Fonte única: <code className="px-1 py-0.5 rounded bg-black/40 text-zinc-300">music_songs</code> (Biblioteca Musical).
                Este painel armazena apenas o relacionamento:
                {" "}<code className="px-1 py-0.5 rounded bg-black/40 text-zinc-300">aluno_id + song_id + status + progresso + observação</code>.
              </p>
            </div>

          </div>
        </div>
      </div>

      {/* =====================================================================
          3 MODAIS + 1 DIÁLOGO DE ESCOLHA DE STATUS
         ===================================================================== */}
      {/* MODAL: + Adicionar música (busca + filtros reutilizando GET /admin/music/songs) */}
      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 p-2 md:p-6 backdrop-blur-sm"
             onClick={() => setAddOpen(false)}>
          <div className="w-full max-w-[960px] max-h-[92vh] overflow-y-auto rounded-2xl md:rounded-3xl border border-white/10 bg-[#0d0d0d] shadow-2xl flex flex-col"
               onClick={(e) => e.stopPropagation()}>
            <div className="px-4 md:px-6 py-4 border-b border-white/5 flex items-start justify-between gap-3 sticky top-0 bg-[#0d0d0d] z-10">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1">
                  <Music4 className="w-3 h-3" /> Repertório • {studentName}
                </div>
                <h3 className="text-lg md:text-xl font-black text-white leading-tight break-words">
                  Adicionar música ao repertório
                </h3>
                <div className="text-xs text-zinc-400 mt-1">Busca nome/artista ou combina filtros pedagógicos.</div>
              </div>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="w-9 h-9 rounded-xl hover:bg-white/5 border border-white/10 flex items-center justify-center shrink-0 min-w-[44px] min-h-[44px]"
              >
                <X className="w-4 h-4 text-zinc-300" />
              </button>
            </div>
            <div className="px-4 md:px-6 py-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    placeholder="🔎 Buscar música por nome ou artista..."
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-xs md:text-sm outline-none focus:border-white/20 placeholder:text-zinc-600"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setAddFiltersOpen(v => !v)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2.5 rounded-xl border font-bold text-xs md:text-sm whitespace-nowrap transition min-h-[44px]",
                    addFiltersOpen
                      ? "bg-[#a855f7]/15 border-[#a855f7]/40 text-[#e9d5ff]"
                      : "bg-black/40 border-white/10 text-zinc-300 hover:bg-white/5"
                  )}
                >
                  <SlidersHorizontal className="w-4 h-4" /> Filtros
                </button>
              </div>
              {addFiltersOpen ? (
                <div className="rounded-2xl border border-[#a855f7]/20 bg-[#a855f7]/5 p-3 md:p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
                  <FilterSelect label="Instrumento aplicável"
                    value={addFilters.instrument_id}
                    onChange={(v) => setAddFilters(p => ({ ...p, instrument_id: v }))}
                    placeholder="Qualquer"
                    options={addCatalogs.instruments.map(i => ({ value: String(i.id), label: i.name }))}
                  />
                  <FilterSelect label="Nível"
                    value={addFilters.level}
                    onChange={(v) => setAddFilters(p => ({ ...p, level: v }))}
                    placeholder="Qualquer"
                    options={LEVELS.filter(x => x.value).map(x => ({ value: x.value, label: x.label }))}
                  />
                  <FilterSelect label="Estilo principal"
                    value={addFilters.main_style}
                    onChange={(v) => setAddFilters(p => ({ ...p, main_style: v }))}
                    placeholder="Qualquer"
                    options={(addCatalogs.styles || []).map(s => ({ value: s, label: s }))}
                  />
                  <FilterSelect label="Compasso"
                    value={addFilters.time_signature}
                    onChange={(v) => setAddFilters(p => ({ ...p, time_signature: v }))}
                    placeholder="Qualquer"
                    options={["2/4","3/4","4/4","6/8","9/8"].map(v => ({ value: v, label: v }))}
                  />
                  <FilterSelect label="Objetivo pedagógico"
                    value={addFilters.objective_id}
                    onChange={(v) => setAddFilters(p => ({ ...p, objective_id: v }))}
                    placeholder="Qualquer"
                    options={addCatalogs.objectives.map(o => ({ value: String(o.id), label: o.name }))}
                  />
                  <FilterSelect label="Técnica trabalhada"
                    value={addFilters.technique_id}
                    onChange={(v) => setAddFilters(p => ({ ...p, technique_id: v }))}
                    placeholder="Qualquer"
                    options={addCatalogs.techniques.map(t => ({ value: String(t.id), label: t.name }))}
                  />
                  <div className="sm:col-span-2 md:col-span-1 space-y-1">
                    <span className="block text-[10px] uppercase tracking-wide text-zinc-400 font-bold">Máx. acordes</span>
                    <input
                      type="number" min={0} max={30} step={1}
                      value={addFilters.max_chords}
                      onChange={(e) => setAddFilters(p => ({ ...p, max_chords: e.target.value }))}
                      placeholder="Sem limite"
                      className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white text-xs outline-none placeholder:text-zinc-600 min-h-[44px]"
                    />
                  </div>
                </div>
              ) : null}

              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>{addSearching ? "🔍 Buscando..." : `${addResults.length} música${addResults.length === 1 ? "" : "s"} encontrada${addResults.length === 1 ? "" : "s"}`}</span>
              </div>

              <div className="space-y-2">
                {addResults.length === 0 && !addSearching ? (
                  <div className="rounded-xl border border-white/5 bg-black/30 p-3 text-xs text-zinc-500">
                    Nenhum resultado. Tente ajustar os filtros ou limpar a busca.
                  </div>
                ) : null}
                {addResults.map(s => (
                  <SongListCard key={s.id} s={s}
                    primaryText="Adicionar ao repertório"
                    onPrimary={() => { setPendingStatus("planned"); setPendingAdd({ song: s }); }}
                    onOpen={() => openSong(s)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* MODAL: ✨ Sugerir músicas para este aluno */}
      {suggestOpen ? (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 p-2 md:p-6 backdrop-blur-sm"
             onClick={() => setSuggestOpen(false)}>
          <div className="w-full max-w-[960px] max-h-[92vh] overflow-y-auto rounded-2xl md:rounded-3xl border border-white/10 bg-[#0d0d0d] shadow-2xl flex flex-col"
               onClick={(e) => e.stopPropagation()}>
            <div className="px-4 md:px-6 py-4 border-b border-white/5 flex items-start justify-between gap-3 sticky top-0 bg-[#0d0d0d] z-10">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1">
                  <Sparkles className="w-3 h-3 text-[#22c55e]" /> Sugestão pedagógica • {studentName}
                </div>
                <h3 className="text-lg md:text-xl font-black text-white leading-tight break-words">
                  🎯 Sugestões para este aluno
                </h3>
                <div className="text-xs text-zinc-400 mt-1">Compatibilidade calculada a partir de: instrumento · nível · estilos · objetivos · habilidades · dificuldades.</div>
              </div>
              <button
                type="button"
                onClick={() => setSuggestOpen(false)}
                className="w-9 h-9 rounded-xl hover:bg-white/5 border border-white/10 flex items-center justify-center shrink-0 min-w-[44px] min-h-[44px]"
              >
                <X className="w-4 h-4 text-zinc-300" />
              </button>
            </div>
            <div className="px-4 md:px-6 py-4 space-y-3">
              {suggestLoading ? (
                <div className="rounded-xl border border-white/5 bg-black/30 p-3 text-xs text-zinc-400">🔄 Analisando perfil e ranqueando músicas da biblioteca...</div>
              ) : suggestList.length === 0 ? (
                <div className="rounded-xl border border-white/5 bg-black/30 p-3 text-xs text-zinc-500">
                  Nenhuma sugestão disponível. Verifique se a Biblioteca Musical contém músicas cadastradas.
                </div>
              ) : (
                <div className="space-y-3">
                  {suggestList.map((row, idx) => (
                    <div key={row.song.id || idx} className="rounded-2xl border border-white/5 bg-black/30 p-3 md:p-4 flex flex-col md:flex-row md:items-start gap-3 md:gap-4">
                      <div className="md:w-[110px] shrink-0 flex md:flex-col items-center md:items-start justify-between md:justify-start gap-3 md:gap-2">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold hidden md:block">Compatibilidade</div>
                        <div className="flex items-center gap-2 md:w-full">
                          <div className="w-11 h-11 md:w-full md:h-16 rounded-2xl bg-gradient-to-br from-[#22c55e]/20 via-[#0ea5e9]/20 to-[#a855f7]/20 border border-[#22c55e]/30 flex items-center justify-center">
                            <span className="text-[15px] md:text-xl font-black text-white leading-none">{row.score}<span className="text-[10px] md:text-xs text-zinc-300 font-bold">/100</span></span>
                          </div>
                          <div className="flex-1 md:w-full md:mt-2 space-y-1">
                            <div className="h-2 md:h-2.5 w-full rounded-full bg-white/5 overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-[#22c55e] via-[#0ea5e9] to-[#a855f7]" style={{ width: `${row.score}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-bold text-zinc-500">#{idx+1}</span>
                              <button
                                type="button"
                                onClick={() => openSong(row.song)}
                                className="text-sm md:text-base font-black text-white truncate hover:underline underline-offset-2 text-left"
                              >
                                <Music2 className="w-3.5 h-3.5 inline mr-1 text-zinc-300" />
                                {row.song.title || `Música #${String(row.song.id).slice(0,8)}`}
                              </button>
                            </div>
                            {row.song.artist ? <div className="text-xs text-zinc-300 truncate">{row.song.artist}</div> : null}
                            <div className="mt-0.5"><SongMiniInfo s={row.song} /></div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => openSong(row.song)}
                              title="Ver música completa"
                              className="w-9 h-9 rounded-xl bg-black/40 border border-white/10 hover:bg-white/5 flex items-center justify-center min-w-[44px] min-h-[44px]"
                            >
                              <ExternalLink className="w-4 h-4 text-zinc-300" />
                            </button>
                            <button
                              type="button"
                              onClick={() => { setPendingStatus("planned"); setPendingAdd({ song: row.song, fromSuggestion: true }); }}
                              className="px-3 py-2 rounded-xl bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white text-xs font-bold active:scale-[0.98] whitespace-nowrap min-h-[44px]"
                            >
                              + Adicionar
                            </button>
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/5 bg-black/25 p-2.5 space-y-1">
                          <div className="text-[10px] uppercase tracking-wide text-zinc-400 font-bold">Por que recomendamos:</div>
                          <ul className="space-y-1">
                            {row.reasons.map((r, i) => (
                              <li key={i} className="text-[11px] md:text-xs text-zinc-200 leading-snug">{r}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* DIÁLOGO: Escolher status ao adicionar (default: Próxima) */}
      {pendingAdd ? (
        <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/80 p-3 md:p-6 backdrop-blur"
             onClick={() => setPendingAdd(null)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d0d0d] shadow-2xl p-4 md:p-5 space-y-4"
               onClick={(e) => e.stopPropagation()}>
            <div>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1">
                <Music4 className="w-3 h-3" /> Adicionar ao repertório
              </div>
              <div className="text-sm md:text-lg font-black text-white break-words">
                {pendingAdd.song.title || `Música #${String(pendingAdd.song.id).slice(0,8)}`}
              </div>
              {pendingAdd.song.artist ? <div className="text-xs text-zinc-400">{pendingAdd.song.artist}</div> : null}
              <div className="mt-1"><SongMiniInfo s={pendingAdd.song} /></div>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-zinc-400 font-bold">Status inicial</div>
              <div className="grid grid-cols-3 gap-2">
                {(["planned","learning","mastered"] as RepertoryStatus[]).map(st => {
                  const selected = pendingStatus === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setPendingStatus(st)}
                      className={cn(
                        "rounded-xl border px-2 py-3 text-[11px] md:text-xs font-black leading-tight transition active:scale-[0.98]",
                        selected
                          ? cn("ring-2", STATUS_ACCENT_RING[st], "border-white/10", "bg-black/40")
                          : "border-white/10 bg-black/30 text-zinc-400 hover:text-zinc-200"
                      )}
                    >
                      <span className={selected ? STATUS_ACCENT_TEXT[st] : ""}>{STATUS_LABEL[st]}</span>
                      {selected ? <CheckCircle2 className={cn("w-3.5 h-3.5 mt-1 mx-auto", STATUS_ACCENT_TEXT[st])} /> : null}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-zinc-500 leading-relaxed">Padrão: <span className="text-[#c084fc] font-bold">Próxima</span>. Altere para Aprendendo se a música já começou a ser trabalhada.</p>
            </div>
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                disabled={savingAdd}
                onClick={() => setPendingAdd(null)}
                className="flex-1 px-3 py-2.5 rounded-xl bg-black/40 hover:bg-white/5 border border-white/10 text-zinc-200 text-xs md:text-sm font-bold disabled:opacity-40 min-h-[44px]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingAdd}
                onClick={addByStatusAndClosePending}
                className={cn(
                  "flex-1 px-3 py-2.5 rounded-xl text-white text-xs md:text-sm font-black active:scale-[0.98] transition min-h-[44px] shadow-lg disabled:opacity-40",
                  pendingStatus === "learning" ? "bg-gradient-to-r from-[#f97316] to-[#ef4444]"
                  : pendingStatus === "mastered" ? "bg-gradient-to-r from-[#22c55e] to-[#16a34a]"
                  : "bg-gradient-to-r from-[#a855f7] to-[#7c3aed]"
                )}
              >
                {savingAdd ? "Salvando..." : `Adicionar como ${STATUS_LABEL[pendingStatus]}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* MODAL: Detalhe da música original da Biblioteca */}
      <SongDetailModal open={songDetailOpen} onClose={() => { setSongDetailOpen(false); setSongDetailSong(null); }} song={songDetailSong} />
    </div>
  );
}

// ============================================================
// Sub-utilitários usados SOMENTE no modal Adicionar música (para organização).
// Fora do escopo principal porque não precisa de estado do perfil.
// ============================================================
function FilterSelect({ label, value, onChange, placeholder, options }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <span className="block text-[10px] uppercase tracking-wide text-zinc-400 font-bold">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white text-xs outline-none min-h-[44px]"
      >
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o.value} value={o.value} className="bg-[#0d0d0d]">{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function SongListCard({ s, primaryText, onPrimary, onOpen }: {
  s: LibSong;
  primaryText: string;
  onPrimary: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/30 p-3 flex flex-col md:flex-row md:items-start gap-3 md:gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onOpen}
              className="text-sm md:text-base font-black text-white truncate hover:underline underline-offset-2 text-left"
            >
              <Music2 className="w-3.5 h-3.5 inline mr-1 text-zinc-300" />
              {s.title || `Música #${String(s.id).slice(0,8)}`}
            </button>
            {s.artist ? <div className="text-xs text-zinc-300 truncate">{s.artist}</div> : null}
            <div className="mt-1"><SongMiniInfo s={s} /></div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 w-full md:w-auto">
        <button
          type="button"
          onClick={onOpen}
          title="Ver música original na Biblioteca"
          className="flex-1 md:flex-none px-3 py-2 rounded-xl bg-black/40 border border-white/10 hover:bg-white/5 text-zinc-200 text-xs font-bold flex items-center justify-center gap-1.5 min-h-[44px]"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Ver
        </button>
        <button
          type="button"
          onClick={onPrimary}
          className="flex-1 md:flex-none px-3 py-2 rounded-xl bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white text-xs font-bold shadow-lg active:scale-[0.98] transition min-h-[44px]"
        >
          {primaryText}
        </button>
      </div>
    </div>
  );
}
