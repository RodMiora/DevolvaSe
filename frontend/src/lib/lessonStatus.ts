import { supabase } from '@/lib/supabase';

export type DBLessonStatus = 'locked' | 'unlocked' | 'approved' | string;

export interface StudentLessonRow {
  student_id?: string;
  lesson_id?: string;
  is_locked?: boolean | null;
  is_completed?: boolean | null;
  status?: DBLessonStatus | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: any;
}

export interface ExerciseRow {
  id?: string;
  student_id?: string;
  lesson_id?: string;
  video_url?: string | null;
  thumbnail_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  feedback_status?: string | null;
  approved?: boolean | null;
  [key: string]: any;
}

export type UnifiedLessonStatus =
  | 'locked'
  | 'unlocked'
  | 'pending_review'
  | 'approved';

export function resolveLessonStatus(params: {
  access?: StudentLessonRow | null | undefined;
  exercise?: ExerciseRow | null | undefined;
}): UnifiedLessonStatus {
  const { access, exercise } = params;

  if (access?.status) {
    const s = String(access.status).trim().toLowerCase();
    if (s === 'locked' || s === 'bloqueada' || s === 'bloqueado') return 'locked';
    if (s === 'unlocked' || s === 'liberada' || s === 'liberado' || s === 'not-submitted' || s === 'not_submitted') return 'unlocked';
    if (s === 'approved' || s === 'aprovada' || s === 'aprovado' || s === 'completed') return 'approved';
    if (
      s === 'pending_review' ||
      s === 'pending-review' ||
      s === 'awaiting_feedback' ||
      s === 'awaiting-feedback' ||
      s === 'pendente' ||
      s === 'review'
    ) {
      return 'pending_review';
    }
  }

  if (access?.is_completed === true) return 'approved';
  if (exercise) return 'pending_review';
  if (access && access.is_locked === false) return 'unlocked';
  if (access && typeof access.is_locked === 'boolean') {
    return access.is_locked ? 'locked' : 'unlocked';
  }
  if (access) {
    return 'unlocked';
  }
  return 'locked';
}

export function isLessonLocked(status: UnifiedLessonStatus): boolean {
  return status === 'locked';
}

export function lessonStatusTeacher(status: UnifiedLessonStatus):
  | 'locked'
  | 'unlocked'
  | 'awaiting-feedback'
  | 'completed' {
  switch (status) {
    case 'locked':
      return 'locked';
    case 'unlocked':
      return 'unlocked';
    case 'pending_review':
      return 'awaiting-feedback';
    case 'approved':
      return 'completed';
    default:
      return 'unlocked';
  }
}

export type RealtimeCleanupFn = () => void;

export function subscribeStudentLessons(
  studentId: string,
  onEvent: (payload: any) => void
): RealtimeCleanupFn {
  if (!studentId) return () => {};
  const channel = supabase
    .channel(`student_lessons:${studentId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'student_lessons',
        filter: `student_id=eq.${studentId}`,
      },
      (payload) => {
        console.log('[realtime] student_lessons change:', payload);
        try { onEvent(payload); } catch (e) { console.warn('[realtime] onEvent error', e); }
      }
    )
    .subscribe((status) => {
      console.log('[realtime] student_lessons channel status:', status);
    });

  return () => {
    try {
      supabase.removeChannel(channel).catch((e) => console.warn('removeChannel error', e));
    } catch (e) {
      console.warn('removeChannel throw', e);
    }
  };
}

export function subscribeStudentExercises(
  studentId: string,
  onEvent: (payload: any) => void
): RealtimeCleanupFn {
  if (!studentId) return () => {};
  const channel = supabase
    .channel(`exercises:${studentId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'exercises',
        filter: `student_id=eq.${studentId}`,
      },
      (payload) => {
        console.log('[realtime] exercises change:', payload);
        try { onEvent(payload); } catch (e) { console.warn('[realtime] onEvent error', e); }
      }
    )
    .subscribe((status) => {
      console.log('[realtime] exercises channel status:', status);
    });

  return () => {
    try {
      supabase.removeChannel(channel).catch((e) => console.warn('removeChannel error', e));
    } catch (e) {
      console.warn('removeChannel throw', e);
    }
  };
}
