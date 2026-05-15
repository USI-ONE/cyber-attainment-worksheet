/**
 * Per-policy coverage + maturity analyzer. Powers the inline "Review"
 * panel that expands under each policy document on /policy.
 *
 * What the panel needs to answer:
 *   - Which framework categories does this policy back?
 *   - How many controls in each function does it cover, and what
 *     fraction of that function's controls does that represent?
 *   - What's the avg POL score on the controls this policy is linked
 *     to? (i.e., what maturity tier does the policy itself attest to?)
 *   - How many of the linked controls are at-goal vs below-goal? (the
 *     policy claims coverage but the practice may still be catching up).
 *   - When was the policy last updated and when's it due for review?
 *
 * Pure module — no DB, no React. The /policy page hydrates the framework
 * definition + tenant scores once and hands them to PolicyDocumentsTab,
 * which calls into here per expanded policy.
 */

import type { CurrentScore, FrameworkDefinition, PolicyDocument } from '@/lib/supabase/types';

export interface PolicyFunctionCoverage {
  group_id: string;             // GV / ID / PR / DE / RS / RC
  group_name: string;
  linked: number;               // # of this policy's linked controls that fall in this function
  total_in_function: number;    // # of controls in the function (denominator for coverage %)
  coverage_percent: number;     // linked / total_in_function * 100
  pol_avg: number | null;       // avg POL on the linked controls in this function
}

export interface PolicyReview {
  /** Total controls this policy is linked to, across all functions. */
  linked_total: number;
  /** Number of NIST CSF 2.0 functions this policy touches (0–6). */
  functions_touched: number;
  /** Avg POL across all linked controls (null if no POL set on any). */
  pol_avg: number | null;
  /** Avg PRA across all linked controls (null if no PRA set on any). */
  pra_avg: number | null;
  /** Avg GOL across all linked controls (null if no GOL set on any). */
  gol_avg: number | null;
  /** Linked controls where pra >= gol (i.e. the policy's promised coverage
   *  is being delivered in practice). */
  at_goal: number;
  /** Linked controls where pra is set but below gol. */
  below_goal: number;
  /** Linked controls with no pra yet — the policy claims coverage but the
   *  practice score is empty. */
  unmeasured: number;
  /** Per-function breakdown for the bar chart. Includes functions that the
   *  policy DOESN'T touch (with linked=0, coverage_percent=0) so the row
   *  layout stays stable across policies. */
  by_function: PolicyFunctionCoverage[];
  /** Linked controls fully enumerated with their category, for the
   *  expand-control-list affordance. Ordered by group, category, id. */
  linked_controls: {
    control_id: string;
    outcome: string;
    group_id: string;
    group_name: string;
    category_id: string;
    category_name: string;
    pol: number | null;
    pra: number | null;
    gol: number | null;
  }[];
  /** Computed next-review date (effective_date + 1 year) so the UI doesn't
   *  need to compute it inline. Null if no effective_date is set. */
  next_review_date: string | null;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = values.reduce((a, b) => a + b, 0);
  return Math.round((s / values.length) * 100) / 100;
}

export function reviewForPolicy(
  policy: PolicyDocument,
  framework: FrameworkDefinition | null,
  scoresByControl: Record<string, Partial<CurrentScore>>,
): PolicyReview {
  const linkedIds = new Set(policy.linked_control_ids ?? []);
  const linked_total = linkedIds.size;

  // No framework attached → degrade to a control-list-only review. Per-
  // function rollups + coverage percentages don't have meaning without it.
  if (!framework) {
    const linked_controls = [...linkedIds].sort().map((id) => {
      const s = scoresByControl[id];
      return {
        control_id: id,
        outcome: '',
        group_id: '',
        group_name: '',
        category_id: '',
        category_name: '',
        pol: toNum(s?.pol),
        pra: toNum(s?.pra),
        gol: toNum(s?.gol),
      };
    });
    return {
      linked_total,
      functions_touched: 0,
      pol_avg: avg(linked_controls.map((c) => c.pol).filter((n): n is number => n != null)),
      pra_avg: avg(linked_controls.map((c) => c.pra).filter((n): n is number => n != null)),
      gol_avg: avg(linked_controls.map((c) => c.gol).filter((n): n is number => n != null)),
      at_goal: 0,
      below_goal: 0,
      unmeasured: 0,
      by_function: [],
      linked_controls,
      next_review_date: nextReviewFor(policy),
    };
  }

  const by_function: PolicyFunctionCoverage[] = [];
  const allLinked: PolicyReview['linked_controls'] = [];
  const allPol: number[] = [];
  const allPra: number[] = [];
  const allGol: number[] = [];
  let at_goal = 0, below_goal = 0, unmeasured = 0;
  let functionsTouched = 0;

  for (const g of framework.groups) {
    let linked = 0;
    let total_in_function = 0;
    const fnPols: number[] = [];

    for (const cat of g.categories) {
      for (const ctrl of cat.controls) {
        total_in_function += 1;
        if (linkedIds.has(ctrl.id)) {
          linked += 1;
          const s = scoresByControl[ctrl.id];
          const pol = toNum(s?.pol);
          const pra = toNum(s?.pra);
          const gol = toNum(s?.gol);
          if (pol != null) { fnPols.push(pol); allPol.push(pol); }
          if (pra != null) allPra.push(pra);
          if (gol != null) allGol.push(gol);
          if (gol != null) {
            if (pra == null) unmeasured += 1;
            else if (pra >= gol) at_goal += 1;
            else below_goal += 1;
          }
          allLinked.push({
            control_id: ctrl.id,
            outcome: ctrl.outcome,
            group_id: g.id,
            group_name: g.name,
            category_id: cat.id,
            category_name: cat.name,
            pol, pra, gol,
          });
        }
      }
    }
    if (linked > 0) functionsTouched += 1;
    by_function.push({
      group_id: g.id,
      group_name: g.name,
      linked,
      total_in_function,
      coverage_percent: total_in_function === 0
        ? 0
        : Math.round((linked / total_in_function) * 1000) / 10,
      pol_avg: avg(fnPols),
    });
  }

  return {
    linked_total,
    functions_touched: functionsTouched,
    pol_avg: avg(allPol),
    pra_avg: avg(allPra),
    gol_avg: avg(allGol),
    at_goal, below_goal, unmeasured,
    by_function,
    linked_controls: allLinked,
    next_review_date: nextReviewFor(policy),
  };
}

/**
 * Default review cadence: effective_date + 1 year. If a policy doesn't
 * have an effective_date the value is null and the UI shows "—". A future
 * schema migration could add an explicit next_review_date column for
 * tenants that follow a non-annual cadence; until then this is a sensible
 * platform-wide default that matches NIST CSF guidance.
 */
function nextReviewFor(policy: PolicyDocument): string | null {
  if (!policy.effective_date) return null;
  const d = new Date(policy.effective_date + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const next = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()));
  return next.toISOString().slice(0, 10);
}
