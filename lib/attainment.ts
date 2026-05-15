/**
 * Compliance-attainment analyzer.
 *
 * Answers the question: "How much of NIST CSF 2.0 have we actually attained
 * against the goals we declared?" Renders as a bar chart on the dashboard
 * — one bar per CSF function (GV / ID / PR / DE / RS / RC), plus an
 * overall rollup.
 *
 * Attainment definition (audit-friendly, board-defensible):
 *   - A control is "attained" when both pra and gol are set AND pra >= gol.
 *   - A control with no goal is excluded from the denominator. You can't
 *     measure attainment against a target you haven't set; surfacing those
 *     as "not attained" would distort the headline number.
 *   - A control with a goal but no practice score is in the denominator
 *     but NOT in the numerator — that's the honest read: "we set a goal
 *     and haven't measured against it yet, so we haven't attained it."
 *
 * `percent` is rounded to the nearest 0.1 so the bar chart label stays
 * legible at one decimal place. `gap_avg` exposes the average tier delta
 * (gol - pra, clamped at >= 0) across the function's measurable controls,
 * so the dashboard can show "73% attained · avg 0.4 tier gap" — the
 * tightness of the miss when you're not at 100%.
 *
 * Pure module — no DB, no React. Consumed by SummaryDashboard
 * (interactive bar chart) and would slot cleanly into a future board PDF
 * report if we want it printable.
 */

import type { CurrentScore, FrameworkDefinition } from '@/lib/supabase/types';

type Scores = Record<string, Partial<CurrentScore>>;

export interface FunctionAttainment {
  /** Group id (CSF function code: GV, ID, PR, DE, RS, RC). */
  group_id: string;
  /** Display name from the framework definition. */
  group_name: string;
  /** Controls in this function with a Goal score set. */
  total: number;
  /** Of those, controls where pra >= gol. */
  attained: number;
  /** Of those, controls with a goal but no pra yet. */
  unmeasured: number;
  /** Of those, controls with pra but below gol. */
  below: number;
  /** attained / total * 100, rounded to 0.1. NaN-safe: 0 if total == 0. */
  percent: number;
  /** Average gol - pra over the function's controls with both set. 0 if none. */
  gap_avg: number;
}

export interface AttainmentSummary {
  /** Rollup across every function. Same shape as a FunctionAttainment minus
   *  the group fields. */
  overall: {
    total: number;
    attained: number;
    unmeasured: number;
    below: number;
    percent: number;
    gap_avg: number;
  };
  /** Per-function breakdown, in framework-definition order. */
  functions: FunctionAttainment[];
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Compute attainment stats for a single function group.
 */
function computeOne(
  group: FrameworkDefinition['groups'][number],
  scores: Scores,
): FunctionAttainment {
  let total = 0;
  let attained = 0;
  let unmeasured = 0;
  let below = 0;
  let gapSum = 0;
  let gapN = 0;

  for (const cat of group.categories) {
    for (const ctrl of cat.controls) {
      const s = scores[ctrl.id];
      const gol = toNum(s?.gol);
      // No goal → not in the denominator. See module-level comment.
      if (gol == null) continue;
      total += 1;
      const pra = toNum(s?.pra);
      if (pra == null) {
        unmeasured += 1;
      } else if (pra >= gol) {
        attained += 1;
        // Even when attained, gap can be 0 (or negative if exceeded).
        // For the "tightness" metric we only count positive shortfall.
        // So attained controls contribute 0 — no-op.
      } else {
        below += 1;
        gapSum += (gol - pra);
        gapN += 1;
      }
    }
  }

  const percent = total === 0 ? 0 : Math.round((attained / total) * 1000) / 10;
  const gap_avg = gapN === 0 ? 0 : Math.round((gapSum / gapN) * 100) / 100;

  return {
    group_id: group.id,
    group_name: group.name,
    total, attained, unmeasured, below,
    percent, gap_avg,
  };
}

export function computeAttainment(
  definition: FrameworkDefinition,
  scores: Scores,
): AttainmentSummary {
  const functions = definition.groups.map((g) => computeOne(g, scores));

  let total = 0, attained = 0, unmeasured = 0, below = 0, gapSum = 0, gapN = 0;
  for (const f of functions) {
    total += f.total;
    attained += f.attained;
    unmeasured += f.unmeasured;
    below += f.below;
    if (f.gap_avg > 0 && f.below > 0) {
      // Recover the per-control gap sum from the avg so the overall avg
      // is correctly weighted by control count, not function count.
      gapSum += f.gap_avg * f.below;
      gapN += f.below;
    }
  }
  const percent = total === 0 ? 0 : Math.round((attained / total) * 1000) / 10;
  const gap_avg = gapN === 0 ? 0 : Math.round((gapSum / gapN) * 100) / 100;

  return {
    overall: { total, attained, unmeasured, below, percent, gap_avg },
    functions,
  };
}
