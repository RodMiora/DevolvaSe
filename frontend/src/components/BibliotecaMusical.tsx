"use client";
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Music4,
  Plus,
  Search,
  Filter,
  Star,
  ChevronDown,
  ChevronUp,
  Play,
  X,
  Pencil,
  Trash2,
  ChevronLeft,
  ExternalLink,
  Sparkles,
  RefreshCw,
  Music,
  Volume2,
  Clock,
  Target,
  BarChart3,
  BookOpen,
  Guitar,
  Headphones,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiAlert } from "@/lib/api";

// ================================================================
// Tipos (compatíveis com o retorno do backend /admin/music/*)
// ================================================================
interface BaseCatalogItem { id: string; name: string; slug?: string; category?: string; }
interface SongInstrument { id: string; name: string; }
interface Song extends Record<string, any> {
  id: string;
  created_at?: string;
  updated_at?: string;
  title: string;
  artist?: string | null;
  composer?: string | null;
  year?: number | null;
  description?: string | null;
  main_style?: string | null;
  sub_style?: string | null;
  time_signature?: string | null;
  bpm?: number | null;
  original_key?: string | null;
  predominant_instrument_id?: string | null;
  predominant_instrument?: SongInstrument | null;
  level?: string | null;
  rhythm_complexity?: "baixa" | "media" | "alta" | null;
  harmonic_complexity?: "baixa" | "media" | "alta" | null;
  technical_complexity?: "baixa" | "media" | "alta" | null;
  chord_count?: number;
  chords_list?: string[];
  has_barre_chord?: boolean;
  has_7th_chords?: boolean;
  has_extended_chords?: boolean;
  chords_text?: string | null;
  lyrics_chords?: string | null;
  listen_url?: string | null;
  applicable_instruments?: SongInstrument[];
  objectives?: BaseCatalogItem[];
  techniques?: BaseCatalogItem[];
  is_favorite?: boolean;
}

interface Catalogs {
  instruments: BaseCatalogItem[];
  objectives: BaseCatalogItem[];
  techniques: BaseCatalogItem[];
  styles: string[];
}

const LEVEL_LABELS: Record<string, string> = {
  iniciante: "Iniciante",
  basico: "Básico",
  intermediario: "Intermediário",
  intermediario_avancado: "Intermediário/Avançado",
  avancado: "Avançado",
};

const LEVEL_COLORS: Record<string, string> = {
  iniciante: "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30",
  basico: "bg-[#84cc16]/10 text-[#84cc16] border-[#84cc16]/30",
  intermediario: "bg-[#eab308]/10 text-[#eab308] border-[#eab308]/30",
  intermediario_avancado: "bg-[#f97316]/10 text-[#f97316] border-[#f97316]/30",
  avancado: "bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/30",
};

const COMPLEX_LABELS: Record<string, string> = { baixa: "Baixa", media: "Média", alta: "Alta" };
const COMPLEX_COLORS: Record<string, string> = {
  baixa: "text-[#22c55e]",
  media: "text-[#eab308]",
  alta: "text-[#ef4444]",
};

// ================================================================
// Componentes auxiliares (UI kit inline, seguindo o padrão BibliotecaAulas)
// ================================================================
const SimpleModal: React.FC<{
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClass?: string;
}> = ({ open, title, onClose, children, maxWidthClass = "max-w-2xl" }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={cn("w-full", maxWidthClass, "rounded-2xl border border-white/10 bg-[#0d0d0d] max-h-[90vh] overflow-hidden flex flex-col shadow-2xl")}>
        <div className="flex items-center justify-between px-5 md:px-6 py-4 border-b border-white/5">
          <h3 className="text-white font-bold text-lg">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 md:px-6 py-5 space-y-5">{children}</div>
      </div>
    </div>
  );
};

const TextInput: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  accent?: "green" | "orange";
}> = ({ label, value, onChange, placeholder, type = "text", required, accent = "orange" }) => {
  const focusColor = accent === "green" ? "focus:border-[#22c55e]/40" : "focus:border-[#f97316]/40";
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] md:text-xs font-bold text-zinc-400 uppercase tracking-wide">
        {label}{required && <span className="text-[#ef4444] ml-1">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 outline-none text-white text-sm placeholder:text-zinc-600 transition",
          focusColor
        )}
      />
    </label>
  );
};

const NumInput: React.FC<{
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  accent?: "green" | "orange";
}> = ({ label, value, onChange, placeholder, accent = "orange" }) => {
  const focusColor = accent === "green" ? "focus:border-[#22c55e]/40" : "focus:border-[#f97316]/40";
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] md:text-xs font-bold text-zinc-400 uppercase tracking-wide">{label}</span>
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        placeholder={placeholder}
        className={cn(
          "w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 outline-none text-white text-sm placeholder:text-zinc-600 transition",
          focusColor
        )}
      />
    </label>
  );
};

const TextArea: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minH?: string;
  accent?: "green" | "orange";
  monospace?: boolean;
}> = ({ label, value, onChange, placeholder, minH = "min-h-[100px]", accent = "orange", monospace }) => {
  const focusColor = accent === "green" ? "focus:border-[#22c55e]/40" : "focus:border-[#f97316]/40";
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] md:text-xs font-bold text-zinc-400 uppercase tracking-wide">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 outline-none text-sm resize-y transition",
          focusColor, minH,
          monospace ? "font-mono text-[12px] leading-relaxed text-zinc-200" : "text-white"
        )}
      />
    </label>
  );
};

const SelectInput: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  accent?: "green" | "orange";
}> = ({ label, value, onChange, options, accent = "orange" }) => {
  const focusColor = accent === "green" ? "focus:border-[#22c55e]/40" : "focus:border-[#f97316]/40";
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] md:text-xs font-bold text-zinc-400 uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full px-3.5 py-3 rounded-xl bg-zinc-900 border border-white/5 outline-none text-white text-sm transition appearance-none",
          focusColor
        )}
      >
        <option value="">Selecione...</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
};

const CheckboxSwitch: React.FC<{
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, value, onChange }) => (
  <label className="flex items-center gap-2 cursor-pointer select-none p-3 rounded-xl bg-zinc-900/40 border border-white/5 hover:bg-zinc-900 transition">
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 accent-[#f97316] rounded"
    />
    <span className="text-sm text-zinc-200">{label}</span>
  </label>
);

const ChipSelect: React.FC<{
  label: string;
  items: BaseCatalogItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  allowCreate?: boolean;
  onCreate?: (name: string) => Promise<void>;
  accent?: "green" | "orange" | "purple";
  cols?: string;
}> = ({ label, items, selectedIds, onToggle, allowCreate, onCreate, accent = "orange", cols = "grid-cols-2 md:grid-cols-3" }) => {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const borderSel = accent === "green"
    ? "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/40"
    : accent === "purple"
      ? "bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/40"
      : "bg-[#f97316]/10 text-[#f97316] border-[#f97316]/40";

  const handleAdd = async () => {
    if (!onCreate || !newName.trim()) return;
    setSaving(true);
    try { await onCreate(newName.trim()); setNewName(""); setShowAdd(false); }
    catch (e) { apiAlert("Erro ao adicionar item", e); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] md:text-xs font-bold text-zinc-400 uppercase tracking-wide">{label}</span>
        {allowCreate && (
          <button
            onClick={() => setShowAdd(v => !v)}
            className="text-[11px] font-bold text-[#f97316] hover:text-[#fb923c] transition"
          >
            {showAdd ? "Cancelar" : "+ Novo"}
          </button>
        )}
      </div>
      {allowCreate && showAdd && (
        <div className="flex gap-2 mb-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
            placeholder="Nome do novo item..."
            className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-white/5 text-white text-sm outline-none focus:border-[#f97316]/40"
          />
          <button
            disabled={saving || !newName.trim()}
            onClick={() => void handleAdd()}
            className="px-3 py-2 rounded-lg bg-[#f97316] text-white text-xs font-bold disabled:opacity-50"
          >
            {saving ? "..." : "Adicionar"}
          </button>
        </div>
      )}
      <div className={cn("grid gap-1.5 p-1.5 rounded-xl bg-zinc-900/50 border border-white/5 max-h-[240px] overflow-y-auto", cols)}>
        {items.length === 0 ? (
          <div className="col-span-full p-3 text-center text-xs text-zinc-500">Sem itens ainda.</div>
        ) : items.map((it) => {
          const sel = selectedIds.includes(it.id);
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onToggle(it.id)}
              className={cn(
                "px-2.5 py-2 rounded-lg text-[11.5px] font-semibold border text-left transition truncate",
                sel ? borderSel : "bg-transparent border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              )}
              title={it.name}
            >
              {it.name}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const LevelBadge: React.FC<{ level?: string | null }> = ({ level }) => {
  if (!level) return null;
  const cls = LEVEL_COLORS[level] || "bg-zinc-800 text-zinc-400 border-white/10";
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md border text-[10.5px] font-bold uppercase", cls)}>
      {LEVEL_LABELS[level] || level}
    </span>
  );
};

const ComplexityBar: React.FC<{ value?: string | null; label: string }> = ({ value, label }) => {
  const colors: Record<string, string> = { baixa: "#22c55e", media: "#eab308", alta: "#ef4444" };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10.5px] font-bold uppercase">
        <span className="text-zinc-500">{label}</span>
        <span className={cn(COMPLEX_COLORS[value || ""] || "text-zinc-500")}>{COMPLEX_LABELS[value || ""] || "—"}</span>
      </div>
      <div className="flex gap-1 h-1.5">
        {(["baixa","media","alta"] as const).map((v) => (
          <div
            key={v}
            className="flex-1 rounded-full transition-all"
            style={{
              backgroundColor:
                value === v || (v === "media" && (value === "media" || value === "alta")) || (v === "baixa" && value !== undefined)
                  ? colors[v]
                  : "#1f2937",
              opacity: (v === "baixa" ? 1 : v === "media" ? (value === "media" || value === "alta" ? 1 : 0.3) : (value === "alta" ? 1 : 0.3)),
            }}
          />
        ))}
      </div>
    </div>
  );
};

const SectionHeader: React.FC<{ title: string; sub?: string; icon?: React.ReactNode; accent?: "green" | "orange" | "purple" }> = ({
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

export default function BibliotecaMusical({ teacherId }: { teacherId?: string | null }) {
  // ============ STATES ============
  const [catalogs, setCatalogs] = useState<Catalogs>({ instruments: [], objectives: [], techniques: [], styles: [] });
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [catalogsLoaded, setCatalogsLoaded] = useState(false);

  // Filtros
  const [showFilters, setShowFilters] = useState(true);
  const [fSearch, setFSearch] = useState("");
  const [fInstrumentId, setFInstrumentId] = useState("");
  const [fPredominantId, setFPredominantId] = useState("");
  const [fLevel, setFLevel] = useState("");
  const [fStyle, setFStyle] = useState("");
  const [fTimeSignature, setFTimeSignature] = useState("");
  const [fObjectiveId, setFObjectiveId] = useState("");
  const [fTechniqueId, setFTechniqueId] = useState("");
  const [fMaxChords, setFMaxChords] = useState<number | null>(null);
  const [fOnlyFavorites, setFOnlyFavorites] = useState(false);

  // Seleções
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const editorColRef = useRef<HTMLDivElement>(null);

  // Modal cadastrar/editar música
  const [songModalOpen, setSongModalOpen] = useState(false);
  const [editing, setEditing] = useState<Song | null>(null);
  const [saving, setSaving] = useState(false);

  // --- Campos do formulário ---
  const [f_title, setF_title] = useState("");
  const [f_artist, setF_artist] = useState("");
  const [f_composer, setF_composer] = useState("");
  const [f_year, setF_year] = useState<number | null>(null);
  const [f_description, setF_description] = useState("");
  const [f_mainStyle, setF_mainStyle] = useState("");
  const [f_subStyle, setF_subStyle] = useState("");
  const [f_timeSig, setF_timeSig] = useState("");
  const [f_bpm, setF_bpm] = useState<number | null>(null);
  const [f_originalKey, setF_originalKey] = useState("");
  const [f_predominant, setF_predominant] = useState("");
  const [f_level, setF_level] = useState("");
  const [f_rhythmC, setF_rhythmC] = useState("");
  const [f_harmC, setF_harmC] = useState("");
  const [f_techC, setF_techC] = useState("");
  const [f_chordCount, setF_chordCount] = useState<number | null>(null);
  const [f_chordsText, setF_chordsText] = useState("");
  const [f_hasBarre, setF_hasBarre] = useState(false);
  const [f_has7, setF_has7] = useState(false);
  const [f_hasExt, setF_hasExt] = useState(false);
  const [f_lyrics, setF_lyrics] = useState("");
  const [f_listenUrl, setF_listenUrl] = useState("");
  const [f_applicableIds, setF_applicableIds] = useState<string[]>([]);
  const [f_objectiveIds, setF_objectiveIds] = useState<string[]>([]);
  const [f_techniqueIds, setF_techniqueIds] = useState<string[]>([]);

  const toggleIn = (arr: string[], setArr: (v: string[]) => void, id: string) =>
    setArr(arr.includes(id) ? arr.filter(i => i !== id) : [...arr, id]);

  // ============ LOADS ============
  const loadCatalogs = useCallback(async () => {
    try {
      const res = await apiFetch('/admin/music/catalogs', { method: 'GET' },
        { prefix: 'Erro ao carregar catálogos da biblioteca musical', throwOnError: false, bearer: true });
      if (res && res.ok) {
        const data = await res.json().catch(() => ({ instruments:[], objectives:[], techniques:[], styles:[] }));
        setCatalogs({
          instruments: (data?.instruments || []).map((r: any) => ({ id: String(r.id), name: r.name })),
          objectives: (data?.objectives || []).map((r: any) => ({ id: String(r.id), name: r.name, slug: r.slug })),
          techniques: (data?.techniques || []).map((r: any) => ({ id: String(r.id), name: r.name, slug: r.slug, category: r.category })),
          styles: data?.styles || [],
        });
        setCatalogsLoaded(true);
      }
    } catch (e) { apiAlert("Erro ao carregar catálogos", e); }
  }, []);

  const loadSongs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fSearch.trim()) params.append('search', fSearch.trim());
      if (fInstrumentId) params.append('instrument_id', fInstrumentId);
      if (fPredominantId) params.append('predominant_instrument_id', fPredominantId);
      if (fLevel) params.append('level', fLevel);
      if (fStyle) params.append('main_style', fStyle);
      if (fTimeSignature) params.append('time_signature', fTimeSignature);
      if (fObjectiveId) params.append('objective_id', fObjectiveId);
      if (fTechniqueId) params.append('technique_id', fTechniqueId);
      if (fMaxChords !== null) params.append('max_chords', String(fMaxChords));
      if (fOnlyFavorites) params.append('only_favorites', 'true');
      if (teacherId) params.append('teacher_id', teacherId);

      const url = `/admin/music/songs${params.toString() ? '?' + params.toString() : ''}`;
      const res = await apiFetch(url, { method: 'GET' },
        { prefix: 'Erro ao buscar músicas', throwOnError: false, bearer: true });
      if (res && res.ok) {
        const data = await res.json().catch(() => ({ count: 0, songs: [] }));
        setSongs((data?.songs || []) as Song[]);
        if (selectedSong) {
          const still = (data?.songs || []).find((s: Song) => s.id === selectedSong.id);
          if (still) setSelectedSong(still as Song);
          else setSelectedSong(null);
        }
      }
    } catch (e) { apiAlert("Erro ao listar músicas", e); }
    finally { setLoading(false); }
  }, [fSearch, fInstrumentId, fPredominantId, fLevel, fStyle, fTimeSignature, fObjectiveId, fTechniqueId, fMaxChords, fOnlyFavorites, teacherId, selectedSong]);

  useEffect(() => { void loadCatalogs(); }, [loadCatalogs]);
  useEffect(() => { void loadSongs(); }, [loadSongs]);

  // Auto-scroll da coluna direita (padrão BibliotecaAulas)
  useEffect(() => {
    if (selectedSong && editorColRef.current) {
      setTimeout(() => {
        try { editorColRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
      }, 50);
    }
  }, [selectedSong]);

  // ============ AÇÕES ============
  const resetForm = () => {
    setEditing(null);
    setF_title(""); setF_artist(""); setF_composer(""); setF_year(null); setF_description("");
    setF_mainStyle(""); setF_subStyle(""); setF_timeSig(""); setF_bpm(null); setF_originalKey("");
    setF_predominant(""); setF_level(""); setF_rhythmC(""); setF_harmC(""); setF_techC("");
    setF_chordCount(null); setF_chordsText(""); setF_hasBarre(false); setF_has7(false); setF_hasExt(false);
    setF_lyrics(""); setF_listenUrl(""); setF_applicableIds([]); setF_objectiveIds([]); setF_techniqueIds([]);
  };

  const openCreate = () => { resetForm(); setSongModalOpen(true); };

  const openEdit = (song: Song) => {
    setEditing(song);
    setF_title(song.title || "");
    setF_artist(song.artist || "");
    setF_composer(song.composer || "");
    setF_year(song.year ?? null);
    setF_description(song.description || "");
    setF_mainStyle(song.main_style || "");
    setF_subStyle(song.sub_style || "");
    setF_timeSig(song.time_signature || "");
    setF_bpm(song.bpm ?? null);
    setF_originalKey(song.original_key || "");
    setF_predominant(song.predominant_instrument_id || "");
    setF_level(song.level || "");
    setF_rhythmC(song.rhythm_complexity || "");
    setF_harmC(song.harmonic_complexity || "");
    setF_techC(song.technical_complexity || "");
    setF_chordCount(song.chord_count ?? null);
    setF_chordsText(song.chords_text || "");
    setF_hasBarre(!!song.has_barre_chord);
    setF_has7(!!song.has_7th_chords);
    setF_hasExt(!!song.has_extended_chords);
    setF_lyrics(song.lyrics_chords || "");
    setF_listenUrl(song.listen_url || "");
    setF_applicableIds((song.applicable_instruments || []).map(i => i.id));
    setF_objectiveIds((song.objectives || []).map(o => o.id));
    setF_techniqueIds((song.techniques || []).map(t => t.id));
    setSongModalOpen(true);
  };

  const closeModal = () => { setSongModalOpen(false); resetForm(); };

  const handleSave = async () => {
    if (!f_title.trim()) { alert("Nome da música é obrigatório."); return; }
    setSaving(true);
    try {
      const body: Record<string, any> = {
        title: f_title.trim(), artist: f_artist || null, composer: f_composer || null,
        year: f_year ?? null, description: f_description || null,
        main_style: f_mainStyle || null, sub_style: f_subStyle || null,
        time_signature: f_timeSig || null, bpm: f_bpm ?? null, original_key: f_originalKey || null,
        predominant_instrument_id: f_predominant || null, level: f_level || null,
        rhythm_complexity: f_rhythmC || null, harmonic_complexity: f_harmC || null,
        technical_complexity: f_techC || null, chord_count: f_chordCount ?? 0,
        chords_list: [], // manter vazio (campo novo - backend calcula automaticamente)
        has_barre_chord: f_hasBarre, has_7th_chords: f_has7, has_extended_chords: f_hasExt,
        chords_text: f_chordsText || null, lyrics_chords: f_lyrics || null,
        listen_url: f_listenUrl || null,
        applicable_instrument_ids: f_applicableIds,
        objective_ids: f_objectiveIds, technique_ids: f_techniqueIds,
      };

      const method = editing ? 'PATCH' : 'POST';
      const url = editing ? `/admin/music/songs/${editing.id}` : '/admin/music/songs';

      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(body),
      }, { jsonBody: true, bearer: true, throwOnError: false, prefix: editing ? 'Erro ao atualizar música' : 'Erro ao cadastrar música' });

      if (res?.ok) {
        alert(editing ? "✅ Música atualizada com sucesso!" : "✅ Música cadastrada com sucesso!");
        closeModal();
        await loadSongs();
        await loadCatalogs();
      }
    } catch (e) { apiAlert("Erro ao salvar", e); }
    finally { setSaving(false); }
  };

  const handleDelete = async (song: Song) => {
    if (!confirm(`Excluir a música "${song.title}"? Esta ação é irreversível.`)) return;
    try {
      const res = await apiFetch(`/admin/music/songs/${song.id}`, { method: 'DELETE' },
        { jsonBody: true, bearer: true, throwOnError: false, prefix: "Erro ao excluir música" });
      if (res?.ok) {
        if (selectedSong?.id === song.id) setSelectedSong(null);
        await loadSongs();
      }
    } catch (e) { apiAlert("Erro ao excluir", e); }
  };

  const toggleFav = async (song: Song) => {
    try {
      const nextFav = !song.is_favorite;
      const res = await apiFetch(`/admin/music/songs/${song.id}/favorite`, {
        method: 'POST',
        body: JSON.stringify({ song_id: song.id, teacher_id: teacherId || "", is_favorite: nextFav }),
      }, { jsonBody: true, bearer: true, throwOnError: false, prefix: "Erro ao marcar favorito" });
      if (res?.ok) {
        setSongs(list => list.map(s => s.id === song.id ? { ...s, is_favorite: nextFav } : s));
        if (selectedSong?.id === song.id) setSelectedSong({ ...selectedSong, is_favorite: nextFav });
      }
    } catch (e) { apiAlert("Erro favorito", e); }
  };

  const addObjective = async (name: string) => {
    const res = await apiFetch(`/admin/music/objectives?name=${encodeURIComponent(name)}`, { method: 'POST' },
      { jsonBody: false, bearer: true, throwOnError: false });
    if (res?.ok) {
      await loadCatalogs();
      const d = await res.json().catch(() => ({}));
      if (d?.objective?.id) toggleIn(f_objectiveIds, setF_objectiveIds, String(d.objective.id));
    }
  };

  const addTechnique = async (name: string) => {
    const res = await apiFetch(`/admin/music/techniques?name=${encodeURIComponent(name)}`, { method: 'POST' },
      { jsonBody: false, bearer: true, throwOnError: false });
    if (res?.ok) {
      await loadCatalogs();
      const d = await res.json().catch(() => ({}));
      if (d?.technique?.id) toggleIn(f_techniqueIds, setF_techniqueIds, String(d.technique.id));
    }
  };

  // ============ DERIVADOS ============
  const timeSigsOptions = useMemo(() => {
    const fromSongs = Array.from(new Set(songs.map(s => s.time_signature).filter(Boolean))) as string[];
    const defaultList = ["2/4", "3/4", "4/4", "6/8", "5/4", "7/4", "12/8"];
    const merged = Array.from(new Set([...defaultList, ...fromSongs]));
    return merged.map(v => ({ value: v, label: v }));
  }, [songs]);

  const stylesOpts = useMemo(() => {
    const fromCat = catalogs.styles || [];
    if (f_mainStyle && !fromCat.includes(f_mainStyle)) fromCat.push(f_mainStyle);
    return fromCat.map(v => ({ value: v, label: v }));
  }, [catalogs.styles, f_mainStyle]);

  // ============ RENDER ============
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#050505] w-full overflow-visible"
      style={{ WebkitOverflowScrolling: 'touch' as any }}>

      {/* ============ HEADER ============ */}
      <header className="border-b border-white/5 bg-[#0d0d0d]/60 backdrop-blur px-2.5 md:px-8 py-2.5 md:py-5 space-y-2 md:space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-3">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-9 h-9 md:w-11 md:h-11 rounded-xl md:rounded-2xl bg-gradient-to-br from-[#f97316]/30 via-[#a855f7]/30 to-[#22c55e]/30 flex items-center justify-center text-xl md:text-2xl border border-white/5 shrink-0">
              <Music4 className="w-5 h-5 md:w-6 md:h-6 text-[#f97316]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[17px] md:text-2xl font-bold text-white truncate leading-tight">
                Biblioteca Musical
              </h1>
              <p className="text-[10.5px] md:text-sm text-zinc-500 truncate leading-tight">
                Encontre o repertório ideal para cada objetivo pedagógico
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2 w-full md:w-auto justify-start md:justify-end">
            <button
              onClick={() => { if (!catalogsLoaded) void loadCatalogs(); void loadSongs(); }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 md:px-3 md:py-2 rounded-lg md:rounded-xl bg-zinc-800 text-[11px] md:text-sm font-semibold text-zinc-300 hover:bg-zinc-700 hover:text-white transition shrink-0"
            >
              <RefreshCw className={cn("w-3.5 h-3.5 md:w-4 md:h-4", loading && "animate-spin")} />
              Atualizar
            </button>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 md:py-2 rounded-lg md:rounded-xl bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white text-[11px] md:text-sm font-bold shadow-lg shadow-orange-500/10 disabled:opacity-70 active:scale-[0.98] transition whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" />
              Nova Música
            </button>
          </div>
        </div>

        {/* BARRA BUSCA + FILTROS BOTÃO (MOBILE) */}
        <div className="flex flex-col gap-2 md:gap-3 md:flex-row md:items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              value={fSearch}
              onChange={(e) => setFSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void loadSongs()}
              placeholder="Buscar por nome, artista, compositor..."
              className="w-full pl-9 pr-3 py-2.5 md:py-3 rounded-xl bg-zinc-900 border border-white/5 outline-none text-white text-sm placeholder:text-zinc-600 focus:border-[#f97316]/40 transition"
            />
          </div>
          <button
            onClick={() => setShowFilters(v => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm font-bold transition shrink-0",
              showFilters
                ? "border-[#f97316]/40 text-[#f97316] bg-[#f97316]/5"
                : "border-white/10 text-zinc-300 bg-zinc-800 hover:bg-zinc-700"
            )}
          >
            <Filter className="w-4 h-4" />
            Filtros
            {showFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* ============ PAINEL DE FILTROS ============ */}
        {showFilters && (
          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-3 p-3 md:p-4 rounded-2xl border border-white/5 bg-[#0a0a0a]">
            <SelectInput label="Instrumento (aplicável)" value={fInstrumentId} onChange={setFInstrumentId}
              options={catalogs.instruments.map(i => ({ value: i.id, label: i.name }))} />
            <SelectInput label="Instrumento predominante" value={fPredominantId} onChange={setFPredominantId}
              options={catalogs.instruments.map(i => ({ value: i.id, label: i.name }))} />
            <SelectInput label="Nível" value={fLevel} onChange={setFLevel}
              options={Object.entries(LEVEL_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
            <SelectInput label="Estilo" value={fStyle} onChange={setFStyle} options={stylesOpts} />
            <SelectInput label="Compasso" value={fTimeSignature} onChange={setFTimeSignature}
              options={timeSigsOptions} />
            <SelectInput label="Objetivo pedagógico" value={fObjectiveId} onChange={setFObjectiveId}
              options={catalogs.objectives.map(i => ({ value: i.id, label: i.name }))} />
            <SelectInput label="Técnica" value={fTechniqueId} onChange={setFTechniqueId}
              options={catalogs.techniques.map(i => ({ value: i.id, label: `${i.name}${i.category ? ` (${i.category})` : ""}` }))} />
            <NumInput label="Máximo de acordes" value={fMaxChords} onChange={setFMaxChords} placeholder="ex: 3" />
            <label className="flex items-center gap-2 cursor-pointer col-span-2 md:col-span-1 p-2.5 rounded-xl bg-zinc-900 border border-white/5 hover:bg-zinc-800 transition self-stretch justify-center">
              <input type="checkbox" checked={fOnlyFavorites} onChange={(e) => setFOnlyFavorites(e.target.checked)}
                className="w-4 h-4 accent-[#f97316]" />
              <span className="text-[12px] md:text-sm font-bold text-yellow-400 inline-flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5 fill-current" /> Apenas favoritas
              </span>
            </label>
          </div>
        )}

        {/* Sumário: quantidade encontrada */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 text-[12px] md:text-sm text-zinc-500">
            <Music className="w-3.5 h-3.5 text-zinc-600" />
            <span>
              {loading ? "Carregando..." : `${songs.length} música${songs.length === 1 ? "" : "s"} encontrada${songs.length === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>
      </header>

      {/* ============ GRID CORPO ============ */}
      <section className={cn(
        "w-full",
        selectedSong
          ? "grid-cols-1 lg:grid lg:grid-cols-[1.05fr_1.45fr]"
          : "grid-cols-1"
      )}>
        {/* ===== COLUNA ESQUERDA: LISTA / CARDS ===== */}
        <div className={cn(
          "border-r border-white/5 bg-[#0a0a0a]",
          selectedSong ? "hidden lg:flex lg:flex-col lg:min-h-0 lg:overflow-hidden" : "flex flex-col min-h-0 w-full"
        )}>
          <div className="p-3 md:p-4 pb-16 md:pb-8 overflow-y-auto"
            style={{ WebkitOverflowScrolling: 'touch' as any }}>
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-10 h-10 border-4 border-[#f97316] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : songs.length === 0 ? (
              <div className="mt-4 text-center px-3 py-10 rounded-xl border border-dashed border-white/10 bg-[#0d0d0d]/50 w-full max-w-[420px] mx-auto">
                <div className="text-4xl mb-3">🎵</div>
                <div className="text-base font-semibold text-white">Sem músicas ainda</div>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed max-w-xs mx-auto">
                  Cadastre a primeira música da sua biblioteca musical.
                  Clique no botão <span className="text-[#f97316] font-bold inline-flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> Nova Música
                  </span>{" "}no topo para começar a construir seu repertório pedagógico.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                {songs.map((song) => (
                  <div
                    key={song.id}
                    onClick={() => setSelectedSong(song)}
                    className={cn(
                      "relative group rounded-xl md:rounded-2xl border cursor-pointer transition-all overflow-hidden",
                      "bg-[#0d0d0d] hover:bg-zinc-900/80",
                      selectedSong?.id === song.id
                        ? "border-[#f97316]/40 shadow-[0_0_30px_rgba(249,115,22,0.12)] ring-1 ring-[#f97316]/20"
                        : "border-white/5 hover:border-white/10"
                    )}
                  >
                    {/* Header card: artista, title, estrela */}
                    <div className="p-3.5 md:p-4 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <LevelBadge level={song.level} />
                            {song.time_signature && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-white/10 bg-zinc-900 text-[10px] font-bold text-zinc-400">
                                <Clock className="w-3 h-3 mr-1 opacity-70" /> {song.time_signature}
                              </span>
                            )}
                            {song.chord_count !== undefined && song.chord_count !== null && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-white/10 bg-zinc-900 text-[10px] font-bold text-zinc-400">
                                <Target className="w-3 h-3 mr-1 opacity-70" /> {song.chord_count} acorde{song.chord_count === 1 ? "" : "s"}
                              </span>
                            )}
                          </div>
                          <h3 className="text-[15px] md:text-[16px] font-extrabold text-white truncate leading-tight">
                            {song.title}
                          </h3>
                          <p className="text-[12px] md:text-[13px] text-zinc-500 truncate leading-tight mt-0.5">
                            {song.artist || "Artista não informado"}
                          </p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); void toggleFav(song); }}
                          className={cn(
                            "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all",
                            "hover:bg-yellow-500/10",
                            song.is_favorite ? "text-yellow-400" : "text-zinc-600 hover:text-yellow-300"
                          )}
                          title={song.is_favorite ? "Desmarcar favorita" : "Marcar como favorita"}
                        >
                          <Star className={cn("w-4 h-4", song.is_favorite && "fill-current")} />
                        </button>
                      </div>

                      {/* Detalhes: estilo / instrumento */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                        {song.main_style && (
                          <span className="inline-flex px-2 py-0.5 rounded-md bg-[#a855f7]/10 border border-[#a855f7]/20 text-[#a855f7] font-bold">
                            {song.main_style}
                          </span>
                        )}
                        {song.sub_style && (
                          <span className="text-zinc-500">{song.sub_style}</span>
                        )}
                        <span className="text-zinc-700">·</span>
                        <span className="inline-flex items-center gap-1 text-zinc-400">
                          <Guitar className="w-3 h-3 opacity-60" />
                          <span className="truncate">
                            {song.predominant_instrument?.name || "Instrumento variado"}
                          </span>
                        </span>
                      </div>

                      {/* Tags: objetivos */}
                      {song.objectives?.length ? (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {song.objectives.slice(0, 3).map(o => (
                            <span key={o.id} className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-[#22c55e]/8 border border-[#22c55e]/20 text-[10px] font-bold text-[#22c55e]">
                              {o.name}
                            </span>
                          ))}
                          {song.objectives.length > 3 && (
                            <span className="text-[10px] text-zinc-500 font-semibold self-center">+{song.objectives.length - 3}</span>
                          )}
                        </div>
                      ) : null}
                    </div>

                    {/* Ações inferiores (botões Ouvir / Editar / Excluir) */}
                    <div className="flex items-center gap-1.5 p-2.5 md:p-3 border-t border-white/5 bg-black/30">
                      {song.listen_url && (
                        <a
                          href={song.listen_url}
                          target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#22c55e]/10 text-[#22c55e] text-[11.5px] font-bold border border-[#22c55e]/20 hover:bg-[#22c55e]/15 transition shrink-0"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" /> Ouvir
                        </a>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(song); }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/5 text-zinc-400 text-[11.5px] font-semibold hover:bg-white/5 hover:text-white transition shrink-0 ml-auto"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Editar
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleDelete(song); }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-500/20 text-red-400 text-[11.5px] font-semibold hover:bg-red-500/10 transition shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedSong(song); }}
                        className="lg:hidden inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[#f97316] text-[11.5px] font-bold border border-[#f97316]/20 bg-[#f97316]/5 hover:bg-[#f97316]/10 transition shrink-0"
                      >
                        Ver →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ===== COLUNA DIREITA: DETALHES ===== */}
        <section
          ref={editorColRef}
          className={cn(
            "bg-[#050505]",
            !selectedSong
              ? "hidden lg:flex lg:flex-col lg:min-h-0 lg:overflow-y-auto lg:px-6 lg:py-5 lg:pb-24"
              : "flex flex-col min-h-0 overflow-y-auto px-3 py-3 md:px-6 md:py-5 pb-32"
          )}
        >
          {!selectedSong ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#f97316]/20 via-[#a855f7]/20 to-[#22c55e]/20 border border-white/10 flex items-center justify-center mb-5 shadow-2xl">
                <Sparkles className="w-10 h-10 text-[#f97316]" />
              </div>
              <h3 className="text-white text-xl font-bold">Escolha uma música</h3>
              <p className="text-zinc-500 text-sm max-w-sm mt-2 leading-relaxed">
                Navegue pelos cards à esquerda e selecione uma música para ver
                os detalhes completos, acordes, letra/cifra, objetivos pedagógicos e mais.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Header do detalhe + voltar (mobile) */}
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-white/5">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => setSelectedSong(null)}
                    className="lg:hidden p-2 rounded-lg border border-white/5 bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800 transition shrink-0"
                    title="Voltar para lista"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 md:w-12 md:h-12 rounded-2xl bg-gradient-to-br from-[#f97316]/25 via-[#a855f7]/20 to-[#22c55e]/20 border border-white/5 flex items-center justify-center shrink-0">
                      <Headphones className="w-5 h-5 md:w-6 md:h-6 text-[#f97316]" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <LevelBadge level={selectedSong.level} />
                        <button
                          onClick={() => void toggleFav(selectedSong)}
                          className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center border transition",
                            selectedSong.is_favorite
                              ? "border-yellow-400/40 bg-yellow-400/10 text-yellow-400"
                              : "border-white/5 text-zinc-500 hover:text-yellow-300 hover:bg-yellow-500/5"
                          )}
                        >
                          <Star className={cn("w-4 h-4", selectedSong.is_favorite && "fill-current")} />
                        </button>
                      </div>
                      <h2 className="text-[20px] md:text-[24px] font-extrabold text-white leading-tight break-words">
                        {selectedSong.title}
                      </h2>
                      <p className="text-zinc-400 text-sm mt-1">
                        {selectedSong.artist || ""}
                        {selectedSong.composer ? (
                          <span className="text-zinc-600 ml-2">· Composição: {selectedSong.composer}</span>
                        ) : null}
                        {selectedSong.year ? <span className="text-zinc-600 ml-2">· {selectedSong.year}</span> : null}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {selectedSong.listen_url && (
                    <a
                      href={selectedSong.listen_url}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-white text-xs md:text-sm font-bold shadow-lg shadow-green-500/10 active:scale-95 transition whitespace-nowrap"
                    >
                      <Play className="w-4 h-4 fill-current" /> Ouvir música
                    </a>
                  )}
                  <button
                    onClick={() => openEdit(selectedSong)}
                    className="p-2 rounded-xl border border-white/5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
                    title="Editar"
                  >
                    <Pencil className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => void handleDelete(selectedSong)}
                    className="p-2 rounded-xl border border-red-500/20 text-red-400 hover:bg-red-500/10 transition"
                    title="Excluir"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Bloco 1: Infos musicais */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                <div className="space-y-4">
                  <SectionHeader title="Informações" sub="Classificação geral da música" icon={<BookOpen className="w-5 h-5" />} accent="green" />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl border border-white/5 bg-[#0d0d0d]">
                      <div className="text-[10px] uppercase font-bold text-zinc-500 mb-0.5">Estilo</div>
                      <div className="text-[14px] font-bold text-white">{selectedSong.main_style || "—"}</div>
                      {selectedSong.sub_style && <div className="text-[12px] text-zinc-500">{selectedSong.sub_style}</div>}
                    </div>
                    <div className="p-3 rounded-xl border border-white/5 bg-[#0d0d0d]">
                      <div className="text-[10px] uppercase font-bold text-zinc-500 mb-0.5">Compasso</div>
                      <div className="text-[14px] font-bold text-white inline-flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-zinc-500" />
                        {selectedSong.time_signature || "—"}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl border border-white/5 bg-[#0d0d0d]">
                      <div className="text-[10px] uppercase font-bold text-zinc-500 mb-0.5">BPM</div>
                      <div className="text-[14px] font-bold text-white">{selectedSong.bpm ?? "—"}</div>
                    </div>
                    <div className="p-3 rounded-xl border border-white/5 bg-[#0d0d0d]">
                      <div className="text-[10px] uppercase font-bold text-zinc-500 mb-0.5">Tom original</div>
                      <div className="text-[14px] font-bold text-white">{selectedSong.original_key || "—"}</div>
                    </div>
                  </div>

                  {selectedSong.description && (
                    <div className="p-4 rounded-xl border border-white/5 bg-[#0d0d0d]">
                      <div className="text-[10px] uppercase font-bold text-zinc-500 mb-1.5">Observações</div>
                      <p className="text-[13px] text-zinc-300 leading-relaxed whitespace-pre-wrap">{selectedSong.description}</p>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <SectionHeader title="Complexidades" icon={<BarChart3 className="w-5 h-5" />} sub="Nível detalhado" accent="orange" />
                  <div className="p-4 rounded-xl border border-white/5 bg-[#0d0d0d] space-y-3">
                    <ComplexityBar value={selectedSong.rhythm_complexity} label="Rítmica" />
                    <ComplexityBar value={selectedSong.harmonic_complexity} label="Harmônica" />
                    <ComplexityBar value={selectedSong.technical_complexity} label="Técnica" />
                  </div>

                  <SectionHeader title="Instrumentos" icon={<Guitar className="w-5 h-5" />} accent="green" />
                  <div className="space-y-2">
                    <div className="p-3 rounded-xl border border-[#22c55e]/20 bg-[#22c55e]/[0.04]">
                      <div className="text-[10px] uppercase font-bold text-[#22c55e] mb-1">Predominante</div>
                      <div className="text-[14px] font-bold text-white">
                        {selectedSong.predominant_instrument?.name || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-zinc-500 mb-1.5">Aplicáveis</div>
                      {selectedSong.applicable_instruments?.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedSong.applicable_instruments.map((i) => (
                            <span key={i.id} className="inline-flex px-2.5 py-1 rounded-lg border border-white/5 bg-zinc-900 text-[12px] font-bold text-zinc-200">
                              {i.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-zinc-500 text-sm">Nenhum instrumento marcado.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bloco 2: Harmonia / Acordes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                <div className="space-y-3">
                  <SectionHeader title="Harmonia e Acordes" icon={<Target className="w-5 h-5" />} accent="purple" />
                  <div className="p-4 rounded-xl border border-white/5 bg-[#0d0d0d] space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[10px] uppercase font-bold text-zinc-500">Quantidade</div>
                        <div className="text-[22px] font-extrabold text-[#a855f7]">{selectedSong.chord_count || 0}</div>
                      </div>
                      <div className="grid grid-cols-1 gap-1.5 text-right">
                        <CheckboxSwitchReadOnly label="Pestana (barre)" value={!!selectedSong.has_barre_chord} />
                        <CheckboxSwitchReadOnly label="Acordes com 7ª" value={!!selectedSong.has_7th_chords} />
                        <CheckboxSwitchReadOnly label="Acordes com extensões" value={!!selectedSong.has_extended_chords} />
                      </div>
                    </div>

                    {selectedSong.chords_list && selectedSong.chords_list.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase font-bold text-zinc-500 mb-1.5">Lista de acordes</div>
                        <div className="flex flex-wrap gap-1.5">
                          {(selectedSong.chords_list || []).map((c, i) => (
                            <span key={i} className="inline-flex px-2 py-1 rounded-lg bg-zinc-900 border border-white/5 text-[13px] font-bold text-[#a855f7] font-mono">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedSong.chords_text && (
                      <div>
                        <div className="text-[10px] uppercase font-bold text-zinc-500 mb-1.5">Texto explicativo dos acordes</div>
                        <pre className="p-3 rounded-lg bg-black/40 border border-white/5 text-[12px] font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-[220px] overflow-y-auto">
                          {selectedSong.chords_text}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <SectionHeader title="Pedagogia" icon={<Sparkles className="w-5 h-5" />} accent="orange" sub="Como usar esta música em aula" />

                  {/* Objetivos */}
                  <div>
                    <div className="text-[10px] uppercase font-bold text-zinc-500 mb-1.5 flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5 opacity-70" /> Objetivos pedagógicos
                    </div>
                    {selectedSong.objectives?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedSong.objectives.map(o => (
                          <span key={o.id} className="inline-flex px-2.5 py-1 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/25 text-[#22c55e] text-[12px] font-bold">
                            {o.name}
                          </span>
                        ))}
                      </div>
                    ) : <p className="text-zinc-500 text-sm">Nenhum objetivo cadastrado.</p>}
                  </div>

                  {/* Técnicas */}
                  <div className="pt-2">
                    <div className="text-[10px] uppercase font-bold text-zinc-500 mb-1.5 flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5 opacity-70" /> Técnicas trabalhadas
                    </div>
                    {selectedSong.techniques?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedSong.techniques.map(t => (
                          <span key={t.id} className="inline-flex px-2.5 py-1 rounded-lg bg-[#f97316]/10 border border-[#f97316]/25 text-[#f97316] text-[12px] font-bold">
                            {t.name}
                            {t.category && <span className="ml-1.5 text-[10px] opacity-60">({t.category})</span>}
                          </span>
                        ))}
                      </div>
                    ) : <p className="text-zinc-500 text-sm">Nenhuma técnica cadastrada.</p>}
                  </div>
                </div>
              </div>

              {/* Bloco 3: Letra / Cifra */}
              {(selectedSong.lyrics_chords || selectedSong.chords_text) && (
                <div className="space-y-3">
                  <SectionHeader title="Letra / Cifra" icon={<Music className="w-5 h-5" />} accent="green" sub="Conteúdo musical completo" />
                  <div className="p-5 rounded-2xl border border-white/5 bg-[#0d0d0d]">
                    <pre className="text-[13px] md:text-[14px] font-mono leading-[1.9] text-zinc-200 whitespace-pre-wrap break-words">
                      {selectedSong.lyrics_chords || selectedSong.chords_text}
                    </pre>
                  </div>
                </div>
              )}

              {/* Bloco 4: Link externo */}
              {selectedSong.listen_url && (
                <div className="space-y-3">
                  <SectionHeader title="Referência externa" icon={<ExternalLink className="w-5 h-5" />} accent="green" />
                  <a
                    href={selectedSong.listen_url}
                    target="_blank" rel="noreferrer"
                    className="group flex items-center gap-3 p-4 rounded-xl border border-[#22c55e]/20 bg-[#22c55e]/5 hover:bg-[#22c55e]/10 transition"
                  >
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#22c55e] to-[#16a34a] flex items-center justify-center shrink-0">
                      <Play className="w-5 h-5 fill-current text-white ml-0.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-white font-bold">▶ Ouvir música</div>
                      <div className="text-[12px] text-zinc-400 truncate">{selectedSong.listen_url}</div>
                    </div>
                    <ExternalLink className="w-4 h-4 text-[#22c55e] shrink-0 group-hover:translate-x-0.5 transition" />
                  </a>
                </div>
              )}
            </div>
          )}
        </section>
      </section>

      {/* ============ MODAL DE CADASTRO ============ */}
      <SimpleModal
        open={songModalOpen}
        onClose={closeModal}
        maxWidthClass="max-w-4xl"
        title={editing ? `✏️ Editando: ${editing.title}` : "🎵 Cadastrar nova música"}
      >
        <div className="space-y-6">
          {/* Infos básicas */}
          <div>
            <SectionHeader title="Informações básicas" icon={<BookOpen className="w-5 h-5" />} accent="green" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TextInput label="Nome da música *" value={f_title} onChange={setF_title} placeholder="Ex: Ousado Amor" required />
              <TextInput label="Artista / Intérprete" value={f_artist} onChange={setF_artist} placeholder="Ex: Isaías Saad" />
              <TextInput label="Compositor" value={f_composer} onChange={setF_composer} />
              <NumInput label="Ano" value={f_year} onChange={setF_year} />
            </div>
            <div className="mt-3">
              <TextArea label="Descrição / observação" value={f_description} onChange={setF_description}
                placeholder="Informações extras sobre o uso pedagógico da música..." minH="min-h-[80px]" />
            </div>
          </div>

          {/* Classificação musical */}
          <div>
            <SectionHeader title="Classificação musical" icon={<Clock className="w-5 h-5" />} sub="Estilo, compasso, andamento, tom" accent="purple" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <TextInput label="Estilo principal" value={f_mainStyle} onChange={setF_mainStyle} placeholder="Ex: Gospel, Rock, MPB..." />
              <TextInput label="Subestilo" value={f_subStyle} onChange={setF_subStyle} placeholder="Ex: Worship, Pop Rock..." />
              <SelectInput label="Compasso" value={f_timeSig} onChange={setF_timeSig}
                options={timeSigsOptions.filter(o => !["2/4","3/4","4/4","6/8","5/4","7/4","12/8"].includes(o.value)
                  ? [{ value: f_timeSig, label: f_timeSig || "Personalizado" }, ...timeSigsOptions]
                  : timeSigsOptions
                )} />
              <NumInput label="BPM" value={f_bpm} onChange={setF_bpm} placeholder="Ex: 72" />
              <TextInput label="Tom original" value={f_originalKey} onChange={setF_originalKey} placeholder="Ex: C / G / Am..." />
              <SelectInput label="Nível" value={f_level} onChange={setF_level}
                options={Object.entries(LEVEL_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
            </div>
          </div>

          {/* Instrumentos */}
          <div>
            <SectionHeader title="Instrumentos" icon={<Guitar className="w-5 h-5" />} accent="green" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SelectInput label="Instrumento predominante" value={f_predominant} onChange={setF_predominant}
                options={catalogs.instruments.map(i => ({ value: i.id, label: i.name }))} />
              <ChipSelect
                label="Instrumentos aplicáveis (multi seleção)"
                items={catalogs.instruments}
                selectedIds={f_applicableIds}
                onToggle={(id) => toggleIn(f_applicableIds, setF_applicableIds, id)}
                cols="grid-cols-2 md:grid-cols-3"
                accent="green"
              />
            </div>
          </div>

          {/* Complexidades */}
          <div>
            <SectionHeader title="Complexidades" icon={<BarChart3 className="w-5 h-5" />} accent="orange" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <SelectInput label="Rítmica" value={f_rhythmC} onChange={setF_rhythmC}
                options={[
                  { value: "baixa", label: "Baixa" },
                  { value: "media", label: "Média" },
                  { value: "alta", label: "Alta" },
                ]} />
              <SelectInput label="Harmônica" value={f_harmC} onChange={setF_harmC}
                options={[
                  { value: "baixa", label: "Baixa" },
                  { value: "media", label: "Média" },
                  { value: "alta", label: "Alta" },
                ]} />
              <SelectInput label="Técnica" value={f_techC} onChange={setF_techC}
                options={[
                  { value: "baixa", label: "Baixa" },
                  { value: "media", label: "Média" },
                  { value: "alta", label: "Alta" },
                ]} />
            </div>
          </div>

          {/* Harmonia */}
          <div>
            <SectionHeader title="Harmonia e acordes" icon={<Target className="w-5 h-5" />} accent="purple" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <NumInput label="Quantidade de acordes" value={f_chordCount} onChange={setF_chordCount} />
              <div className="col-span-2 grid grid-cols-3 gap-2">
                <CheckboxSwitch label="Possui pestana" value={f_hasBarre} onChange={setF_hasBarre} />
                <CheckboxSwitch label="Possui 7ª" value={f_has7} onChange={setF_has7} />
                <CheckboxSwitch label="Possui extensões" value={f_hasExt} onChange={setF_hasExt} />
              </div>
            </div>
            <TextArea
              label="Lista de acordes (texto explicativo, opcional)"
              value={f_chordsText} onChange={setF_chordsText}
              placeholder="Ex: Progressão principal: C - G - Am - F  (I - V - vi - IV). Ponte: Am - F - C - G..."
              minH="min-h-[90px]"
              accent="orange"
            />
          </div>

          {/* Pedagógico */}
          <div>
            <SectionHeader title="Pedagogia" icon={<Sparkles className="w-5 h-5" />} sub="Objetivos e técnicas" accent="orange" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ChipSelect
                label="Objetivos pedagógicos"
                items={catalogs.objectives}
                selectedIds={f_objectiveIds}
                onToggle={(id) => toggleIn(f_objectiveIds, setF_objectiveIds, id)}
                allowCreate onCreate={addObjective}
                accent="green"
                cols="grid-cols-2"
              />
              <ChipSelect
                label="Técnicas trabalhadas"
                items={catalogs.techniques}
                selectedIds={f_techniqueIds}
                onToggle={(id) => toggleIn(f_techniqueIds, setF_techniqueIds, id)}
                allowCreate onCreate={addTechnique}
                accent="orange"
                cols="grid-cols-2"
              />
            </div>
          </div>

          {/* Letra / Cifra + link */}
          <div>
            <SectionHeader title="Conteúdo musical" icon={<Music className="w-5 h-5" />} accent="green" />
            <div className="grid grid-cols-1 gap-4">
              <TextArea
                label="Letra / Cifra"
                value={f_lyrics} onChange={setF_lyrics}
                placeholder="Cole aqui a letra com cifras. Ex:&#10;&#10;    C        G&#10;Ousado amor, que me amou assim..."
                minH="min-h-[180px]"
                monospace
              />
              <TextInput
                label="Link para ouvir (YouTube / Spotify / etc)"
                value={f_listenUrl} onChange={setF_listenUrl}
                placeholder="https://youtube.com/..."
                type="url"
              />
            </div>
          </div>

          {/* Ações */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-4 border-t border-white/5">
            <p className="text-xs text-zinc-500 max-w-md">
              * Campos marcados com asterisco são obrigatórios. Todos os outros podem ser preenchidos depois.
            </p>
            <div className="flex gap-3">
              <button
                onClick={closeModal}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-zinc-400 hover:text-white hover:bg-zinc-900 transition whitespace-nowrap"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving || !f_title.trim()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white text-sm font-bold shadow-lg shadow-orange-500/10 disabled:opacity-60 active:scale-[0.98] transition whitespace-nowrap"
              >
                {saving ? <><RefreshCw className="w-4 h-4 animate-spin" /> Salvando...</>
                  : editing ? <>Salvar alterações</> : <><Plus className="w-4 h-4" /> Cadastrar música</>}
              </button>
            </div>
          </div>
        </div>
      </SimpleModal>
    </div>
  );
}

const CheckboxSwitchReadOnly: React.FC<{ label: string; value: boolean }> = ({ label, value }) => (
  <div className="inline-flex items-center gap-1.5 text-[11.5px]">
    <div className={cn("w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0",
      value ? "bg-[#f97316] border-[#f97316]" : "border-zinc-700 bg-zinc-900")}>
      {value && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
    </div>
    <span className={cn(value ? "text-zinc-200" : "text-zinc-500")}>{label}</span>
  </div>
);
