"use client";
import React, { useState, useEffect, useMemo } from "react";
import {
  Music4, Guitar, BookOpen, Target, Star, User, Edit3, Save,
  Sparkles, Music2, Headphones, Award, Play, Plus, X,
  ChevronDown, TrendingUp, Clock as ClockIcon, CheckCircle2,
  Zap, BookMarked
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiAlert } from "@/lib/api";

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
// Repertorio - 3 colunas (Aprendendo / Dominadas / Próximas)
// ============================================================
const REP_COLS: { key: "learning"|"mastered"|"planned"; title: string; accent: "orange"|"green"|"purple"; icon: React.ReactNode }[] = [
  { key: "learning", title: "Aprendendo", accent: "orange", icon: <Play className="w-4 h-4" /> },
  { key: "mastered", title: "Dominadas", accent: "green", icon: <Award className="w-4 h-4" /> },
  { key: "planned", title: "Próximas", accent: "purple", icon: <BookMarked className="w-4 h-4" /> },
];

const RepertorySection: React.FC<{
  repertory: MusicProfile["repertory"];
  onChange: (next: MusicProfile["repertory"]) => void;
  readOnly: boolean;
}> = ({ repertory, onChange, readOnly }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {REP_COLS.map((col) => {
        const items = repertory?.[col.key] ?? [];
        const colorMap = {
          orange: "border-[#f97316]/20 bg-[#f97316]/5",
          green:  "border-[#22c55e]/20 bg-[#22c55e]/5",
          purple: "border-[#a855f7]/20 bg-[#a855f7]/5",
        } as const;
        const chipMap = {
          orange: "bg-[#f97316]/10 text-[#f97316] border-[#f97316]/25",
          green:  "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/25",
          purple: "bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/25",
        } as const;
        const add = (name: string) => {
          if (!name.trim()) return;
          onChange({
            ...(repertory || EMPTY_PROFILE.repertory),
            [col.key]: [...items, { name: name.trim() }]
          });
        };
        const remove = (idx: number) => {
          onChange({
            ...(repertory || EMPTY_PROFILE.repertory),
            [col.key]: items.filter((_, i) => i !== idx)
          });
        };
        return (
          <div key={col.key} className={cn("rounded-2xl border p-3 space-y-2", colorMap[col.accent])}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-7 h-7 rounded-lg flex items-center justify-center border",
                  col.accent === "orange" ? "text-[#f97316] border-[#f97316]/30 bg-black/20"
                  : col.accent === "green" ? "text-[#22c55e] border-[#22c55e]/30 bg-black/20"
                  : "text-[#a855f7] border-[#a855f7]/30 bg-black/20"
                )}>
                  {col.icon}
                </div>
                <div>
                  <div className="text-xs font-bold text-white leading-tight">{col.title}</div>
                  <div className="text-[10px] text-zinc-500">{items.length} {items.length === 1 ? "música" : "músicas"}</div>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              {items.length === 0 && (
                <div className="text-xs text-zinc-500 p-2 rounded-lg bg-black/10">Nenhuma música nesta lista.</div>
              )}
              {items.map((it, idx) => (
                <div key={`${it.song_id || it.name || idx}-${idx}`} className={cn("flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl border text-xs", chipMap[col.accent])}>
                  <span className="truncate font-semibold flex-1 min-w-0">
                    {it.name || (it.song_id ? `#${String(it.song_id).slice(0,8)}` : "Música sem nome")}
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => remove(idx)}
                      className="w-6 h-6 rounded-md hover:bg-black/25 flex items-center justify-center shrink-0"
                      aria-label="Remover"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <RepertoryAddInput onAdd={add} accent={col.accent} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const RepertoryAddInput: React.FC<{ onAdd: (name: string) => void; accent: "green"|"orange"|"purple" }> = ({ onAdd, accent }) => {
  const [val, setVal] = useState("");
  const submit = () => { if (val.trim()) { onAdd(val); setVal(""); } };
  const btn = accent === "green" ? "bg-[#22c55e]" : accent === "purple" ? "bg-[#a855f7]" : "bg-[#f97316]";
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        placeholder={"+ Adicionar música..."}
        className="flex-1 px-2.5 py-2 rounded-xl bg-black/25 border border-white/5 text-white text-xs outline-none focus:border-white/10 placeholder:text-zinc-500 min-w-0"
      />
      <button type="button" onClick={submit} className={cn("px-2.5 py-2 rounded-xl text-black text-xs font-bold shrink-0 min-w-[44px] min-h-[44px]", btn)}>
        <Plus className="w-3.5 h-3.5 mx-auto" />
      </button>
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

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/admin/students/${studentId}/music-profile`, { method: "GET" },
        { prefix: "Erro ao carregar Perfil Musical", throwOnError: false, jsonBody: true });
      if (res && (res as any).ok) {
        const data = await (res as any).json().catch(() => ({ profile: null }));
        if (data?.profile) setProfile({ ...EMPTY_PROFILE, ...data.profile });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!studentId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

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
    const rep = profile.repertory || EMPTY_PROFILE.repertory;
    return {
      mastered:  rep.mastered?.length ?? 0,
      learning:  rep.learning?.length ?? 0,
      planned:   rep.planned?.length ?? 0,
    };
  }, [profile.repertory]);

  const mainStyle = (profile.styles && profile.styles[0]) || "—";

  const readonly = !isEditing;

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

            {/* 7. Repertorio (3 colunas) - ocupa largura total em coluna direita */}
            <div className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-4 md:p-5">
              <SectionHeader title="Repertório do Aluno" icon={<BookOpen className="w-5 h-5" />} sub="Aprendendo • Dominadas • Próximas" accent="purple" />
              <RepertorySection
                repertory={profile.repertory}
                onChange={(next) => setP("repertory", next)}
                readOnly={readonly}
              />
              <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
                💡 Integração futura com a Biblioteca Musical: as músicas aqui serão associadas pelo <code className="px-1 py-0.5 rounded bg-black/40 text-zinc-300">song_id</code>, evitando duplicação de dados.
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
