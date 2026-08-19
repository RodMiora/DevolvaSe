/**
 * utilitários de persistência de navegação e rascunhos para evitar
 * perda de trabalho quando o app vai para background (minimizado)
 * no desktop/mobile e o React "remonta" os componentes.
 *
 * - sessionStorage: usado para NAVEGAÇÃO (abas, seleções do momento).
 *                 Apagado quando fecha o navegador (intencional).
 * - localStorage:  usado para RASCUNHOS NÃO SALVOS (dados de formulários
 *                 digitados mas não enviados). Persistem entre sessões.
 */

export const safeParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

// ============================================================
// CHAVES (todas prefixadas por userId quando aplicavel)
// ============================================================
const keyFor = (userId: string | null | undefined, suffix: string) =>
  `ds:${userId || "anon"}:${suffix}`;

// ============================================================
// TeacherDashboard - navegação
// ============================================================
export type TeacherNavState = {
  activeTab?: 'dashboard' | 'biblioteca' | 'biblioteca_musical' | 'cursos' | 'alunos' | 'config';
  viewMode?: 'chat' | 'perfil_musical' | 'lessons';
  selectedStudentId?: string | null;
  selectedCourseId?: string | null;
  selectedStudentInstrument?: string | null;
  studentLessonsSubTab?: 'modules' | 'prontuario' | 'treinos';
  // NÃO persistimos isMobileMenuOpen (sempre fechado ao voltar é OK),
  // mas persistimos isMobileDetailsView pq é navegação.
  isMobileDetailsView?: boolean;
};

export const loadTeacherNav = (userId: string | null | undefined): TeacherNavState =>
  safeParse<TeacherNavState>(
    typeof window !== 'undefined' ? sessionStorage.getItem(keyFor(userId, "teacher_nav")) : null,
    {} as TeacherNavState
  );

export const saveTeacherNav = (userId: string | null | undefined, s: TeacherNavState): void => {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(keyFor(userId, "teacher_nav"), JSON.stringify(s)); } catch { /* quota ou privacy mode */ }
};

export const clearTeacherNav = (userId: string | null | undefined): void => {
  if (typeof window === 'undefined') return;
  try { sessionStorage.removeItem(keyFor(userId, "teacher_nav")); } catch {}
};

// ============================================================
// Student (MobileLayout) - navegação
// ============================================================
export const loadStudentTab = (userId: string | null | undefined): number => {
  const raw = typeof window !== 'undefined' ? sessionStorage.getItem(keyFor(userId, "student_tab")) : null;
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return 1; // default: aulas
  if (n < 0 || n > 2) return 1;
  return n;
};
export const saveStudentTab = (userId: string | null | undefined, tabIdx: number) => {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(keyFor(userId, "student_tab"), String(tabIdx)); } catch {}
};

// ============================================================
// Rascunhos (localStorage pq queremos sobreviver a fechar o app)
// ============================================================
type DraftBase = { saved_at_ms: number };

export type BibliotecaMusicalDraft = DraftBase & {
  editingSongId?: string | null;
  modal_open?: boolean;
  fields: Record<string, any>;
  selectedApplicableIds?: string[];
  selectedObjectiveIds?: string[];
  selectedTechniqueIds?: string[];
};
export const bmDraftKey = (teacherId: string | null | undefined) =>
  keyFor(teacherId, "draft:biblioteca_musical");
export const loadBmDraft = (teacherId: string | null | undefined): BibliotecaMusicalDraft | null => {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(bmDraftKey(teacherId));
  return safeParse<BibliotecaMusicalDraft | null>(raw, null);
};
export const saveBmDraft = (teacherId: string | null | undefined, d: BibliotecaMusicalDraft | null): void => {
  if (typeof window === 'undefined') return;
  if (!d) { try { localStorage.removeItem(bmDraftKey(teacherId)); } catch {} return; }
  try { localStorage.setItem(bmDraftKey(teacherId), JSON.stringify({ ...d, saved_at_ms: Date.now() })); } catch {}
};
export const clearBmDraft = (teacherId: string | null | undefined): void => saveBmDraft(teacherId, null);

// Perfil Musical do aluno - rascunho de edição
export type StudentProfileDraft = DraftBase & {
  profile: any;
};
export const spDraftKey = (studentId: string) => `ds:draft:student_music_profile:${studentId}`;
export const loadSpDraft = (studentId: string): StudentProfileDraft | null => {
  if (typeof window === 'undefined' || !studentId) return null;
  return safeParse<StudentProfileDraft | null>(localStorage.getItem(spDraftKey(studentId)), null);
};
export const saveSpDraft = (studentId: string, d: StudentProfileDraft | null): void => {
  if (typeof window === 'undefined' || !studentId) return;
  if (!d) { try { localStorage.removeItem(spDraftKey(studentId)); } catch {} return; }
  try { localStorage.setItem(spDraftKey(studentId), JSON.stringify({ ...d, saved_at_ms: Date.now() })); } catch {}
};
export const clearSpDraft = (studentId: string): void => saveSpDraft(studentId, null);

// ============================================================
// beforeUnload / pagehide helpers
// ============================================================
export const hasUnsavedDraft = (teacherId?: string | null, studentIds: string[] = []): boolean => {
  if (typeof window === 'undefined') return false;
  if (loadBmDraft(teacherId)) return true;
  for (const sid of studentIds) if (loadSpDraft(sid)) return true;
  return false;
};
