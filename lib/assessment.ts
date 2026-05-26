import type { AssessmentAnswer, AssessmentResponse, ItemAnswer } from '@/lib/supabase/types';

/**
 * Compute the Practice score for a control assessment.
 *
 * Score model (transparent, board-defensible) — same shape as the
 * original 3-question version, generalized to N items:
 *
 *   - Each item contributes: no = 0, partial = 0.5, yes = 1.
 *   - avg = sum / N  (so avg lives in [0, 1]).
 *   - Score = 1 + 3 * avg  (so the range stays 1.0 – 4.0).
 *       avg = 0    → 1.0 (Initial)
 *       avg = 0.33 → 2.0 (Repeatable)
 *       avg = 0.67 → 3.0 (Defined)
 *       avg = 1    → 4.0 (Managed)
 *   - If EVERY item is 'yes' AND the evidence narrative is non-empty,
 *     score jumps to 5.0 (Optimizing).
 *   - No items answered → null score.
 *
 * For the previous 3-question version this resolves identically to
 * the old formula (1 + sum where sum ∈ [0, 3]).
 */
export function computePracticeScore(input: {
  items: ItemAnswer[];
  evidence_narrative?: string | null;
}): number | null {
  const { items, evidence_narrative } = input;

  // Filter out unanswered items entirely — they're "skip", not "no".
  const answered = items.filter((it) => it.answer != null);
  if (answered.length === 0) return null;

  const v = (a: AssessmentAnswer | null) => a === 'yes' ? 1 : a === 'partial' ? 0.5 : 0;
  const sum = answered.reduce((s, it) => s + v(it.answer), 0);
  const avg = sum / answered.length;

  let score = 1 + 3 * avg;

  // Optimizing tier requires every item answered AND every answer 'yes'
  // AND the evidence narrative populated. The "every item answered" check
  // protects against gaming with a single Yes.
  const allItemsAnsweredYes =
    answered.length === items.length &&
    answered.every((it) => it.answer === 'yes');
  if (allItemsAnsweredYes && (evidence_narrative ?? '').trim().length > 0) {
    score = 5;
  }

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

/** Has the assessor answered every item in the questionnaire? Used to
 *  gate "Save & Next". */
export function isComplete(items: ItemAnswer[], totalItems: number): boolean {
  if (items.length !== totalItems) return false;
  return items.every((it) => it.answer != null);
}

// ===========================================================================
// Back-compat shims for callers still on the q1/q2/q3 column shape.
// ===========================================================================

/** Read the first three answers out of items_answered into the legacy
 *  q1_documented / q2_followed / q3_measured slots. Used by readers that
 *  haven't been migrated to items_answered yet (lib/recommendations.ts,
 *  the audit binder PDF). Returns nulls if a slot isn't present. */
export function legacyTriplet(items: ItemAnswer[]): {
  q1: AssessmentAnswer | null;
  q2: AssessmentAnswer | null;
  q3: AssessmentAnswer | null;
} {
  const get = (id: string) => items.find((x) => x.id === id)?.answer ?? null;
  return { q1: get('q1'), q2: get('q2'), q3: get('q3') };
}

/** Read items_answered out of an AssessmentResponse with a fallback to the
 *  legacy q1/q2/q3 columns. Existing rows backfilled by migration 0029 will
 *  hit the items_answered path; rows written before any backfill / by very
 *  old code paths fall through to the columns. */
export function itemsFromResponse(
  r: Pick<AssessmentResponse, 'items_answered' | 'q1_documented' | 'q2_followed' | 'q3_measured'> | null | undefined,
): ItemAnswer[] {
  if (!r) return [];
  if (r.items_answered && r.items_answered.length > 0) return r.items_answered;
  return [
    { id: 'q1', answer: r.q1_documented ?? null },
    { id: 'q2', answer: r.q2_followed   ?? null },
    { id: 'q3', answer: r.q3_measured   ?? null },
  ];
}
