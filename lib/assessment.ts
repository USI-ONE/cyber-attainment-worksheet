import type { AssessmentAnswer, AssessmentResponse } from '@/lib/supabase/types';

/**
 * Compute the Practice score that the guided assessment derives from a set
 * of answers. Used by both the API route (on save) and the UI wizard (live
 * preview), so the user sees the same number that gets persisted.
 *
 * Score model (transparent, board-defensible):
 *   - Each of Q1-Q3 contributes: no = 0, partial = 0.5, yes = 1.
 *   - Sum lives in [0, 3].
 *   - Score = 1 + sum, so:
 *       0 yes  → 1.0 (Initial)
 *       1 yes  → 2.0 (Repeatable)
 *       2 yes  → 3.0 (Defined)
 *       3 yes  → 4.0 (Managed)
 *     Partials interpolate at 0.5 increments.
 *   - If all three are 'yes' AND q4_improvement is non-empty,
 *     score jumps to 5.0 (Optimizing) — this is the "we're improving
 *     the process and can show how" tier.
 *   - If no questions are answered yet, score is null.
 */
export function computePracticeScore(input: {
  q1: AssessmentAnswer | null;
  q2: AssessmentAnswer | null;
  q3: AssessmentAnswer | null;
  q4_improvement?: string | null;
}): number | null {
  const { q1, q2, q3, q4_improvement } = input;
  // If literally nothing has been answered yet, don't surface a score.
  if (q1 == null && q2 == null && q3 == null) return null;

  const v = (a: AssessmentAnswer | null) => a === 'yes' ? 1 : a === 'partial' ? 0.5 : 0;
  const sum = v(q1) + v(q2) + v(q3);
  let score = 1 + sum;
  if (sum >= 3 && (q4_improvement ?? '').trim().length > 0) score = 5;
  // Round to one decimal so we never leak floating-point noise into the DB.
  return Math.round(score * 10) / 10;
}

/** Friendly tier name for a numeric score, used in the live preview. */
export function tierForScore(score: number | null): string {
  if (score == null) return '—';
  if (score >= 4.75) return 'Optimizing';
  if (score >= 3.75) return 'Managed';
  if (score >= 2.75) return 'Defined';
  if (score >= 1.75) return 'Repeatable';
  return 'Initial';
}

/** Are all three primary questions answered? Used to gate "Save & Next". */
export function isComplete(r: Pick<AssessmentResponse, 'q1_documented' | 'q2_followed' | 'q3_measured'>): boolean {
  return r.q1_documented != null && r.q2_followed != null && r.q3_measured != null;
}
