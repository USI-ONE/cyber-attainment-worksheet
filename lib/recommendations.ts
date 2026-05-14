/**
 * Practice-gap recommendation engine.
 *
 * Reads each control's Practice score (current_scores.pra) + Goal score
 * (current_scores.gol) + the guided assessment answers (Q1 documented /
 * Q2 followed / Q3 measured / Q4 improvement) and produces an actionable
 * checklist for closing the gap.
 *
 * The score model (from lib/assessment.ts) is CMM-flavoured:
 *
 *     Tier 1  Initial      no documented process
 *     Tier 2  Repeatable   process exists but informal / partial
 *     Tier 3  Defined      written + consistently followed
 *     Tier 4  Managed      defined + measured / audited
 *     Tier 5  Optimizing   managed + continuously improved
 *
 * Recommendations come from two layered sources:
 *
 *   1. **Per-tier transition rungs** — what does ANY control need to climb
 *      one tier? Hard-coded below as TIER_TRANSITIONS. These are the
 *      "no matter the control, you must do X" rungs.
 *
 *   2. **Q-driven specifics** — if the assessment caught a specific failure
 *      (Q1=No: no documentation, Q2=No: documented but not followed, Q3=No:
 *      not measured, Q4 empty: not improving), inject a targeted action.
 *      These hit closer to home than the generic rungs because they reflect
 *      what the user actually answered.
 *
 * The engine is pure — it takes data in, returns recommendations out, no
 * DB / network / framework dependencies. Used by both the /recommendations
 * page (interactive) and the /api/report/recommendations PDF route.
 */

import type { AssessmentAnswer, AssessmentResponse, CurrentScore } from '@/lib/supabase/types';
import { tierForScore } from '@/lib/assessment';

export type GapSeverity = 'critical' | 'high' | 'moderate' | 'minor';

/** A single recommended action for a control. */
export interface Recommendation {
  /** Stable id so the UI can checkbox-state per recommendation later. */
  id: string;
  /** What to do — one imperative sentence, < 100 chars. */
  action: string;
  /** Why it moves the score — one short justification, < 140 chars. */
  why: string;
  /** Which gap drove this recommendation. */
  driver:
    | 'q1_missing_docs'   // Q1 = no/partial → write something down
    | 'q2_not_followed'   // Q2 = no/partial → enforce / own / track exceptions
    | 'q3_not_measured'   // Q3 = no/partial → metrics + cadence
    | 'q4_no_improvement' // Q4 empty + all yes → close the loop
    | 'tier_rung'         // Generic tier-transition rung
    | 'unscored';         // No assessment yet — first answer the questions
}

/** A control's gap analysis: where it is, where it should be, what to do. */
export interface ControlGap {
  control_id: string;
  outcome: string;
  group_id: string;          // Function (GV / ID / PR / DE / RS / RC for CSF)
  group_name: string;
  category_id: string;
  category_name: string;

  /** Current Practice score (1.0..5.0), null if never scored. */
  pra: number | null;
  /** Goal Practice score the tenant set on /worksheet. */
  gol: number | null;
  /** gol - (pra ?? 1) — always >= 0 since we only surface positive gaps. */
  gap: number;
  /** Owner string from current_scores.owner (free text). */
  owner: string | null;
  /** Priority sort field (1..4, P1 = highest), null if unset. */
  prio: number | null;

  /** Tier names for human consumption. */
  current_tier: string;      // e.g., "Initial", "Defined", "—"
  target_tier: string;       // e.g., "Managed"

  /** How urgent: critical >= 2 tiers, high >= 1.5, moderate >= 0.5, minor < 0.5. */
  severity: GapSeverity;

  /** Assessment Q answers (so the UI can show the user what they said). */
  q1: AssessmentAnswer | null;
  q2: AssessmentAnswer | null;
  q3: AssessmentAnswer | null;
  q4: string | null;

  /** The recommendation checklist. Ordered most-impactful first. */
  recommendations: Recommendation[];
}

/** Severity bucket from a numeric gap. */
function severityFromGap(gap: number): GapSeverity {
  if (gap >= 2) return 'critical';
  if (gap >= 1.5) return 'high';
  if (gap >= 0.5) return 'moderate';
  return 'minor';
}

/**
 * Tier-transition rungs. For each "to climb FROM tier N TO tier N+1, here
 * are the universal asks." Phrased as imperatives the assessor can check
 * off without translation. Order within a rung matters — the table reads
 * top-to-bottom as the implementer's work plan.
 */
const TIER_TRANSITIONS: Record<number, { action: string; why: string }[]> = {
  // 1 → 2: get ANYTHING written down + a single owner
  1: [
    { action: 'Pick a single accountable owner for this control.',
      why: 'No-one in charge means no-one will document or enforce it.' },
    { action: 'Write a one-page runbook or SOP — even a draft is enough to leave Initial.',
      why: 'Repeatable tier requires that the process exists in writing somewhere.' },
    { action: 'Pilot the process on at least one system or team for 30 days.',
      why: 'A document with zero real-world adoption is still Initial.' },
  ],
  // 2 → 3: formalize, train, make it the default
  2: [
    { action: 'Promote the draft runbook to an approved policy / standard with a version + owner.',
      why: 'Defined tier requires a versioned, owned artifact — not a personal note.' },
    { action: 'Train every relevant team / asset owner; record acknowledgement.',
      why: 'Consistent following requires consistent awareness.' },
    { action: 'Log exceptions when the standard isn’t followed, with reason + remediation.',
      why: 'Tracked exceptions are how you prove "consistently followed."' },
  ],
  // 3 → 4: measure + review on a cadence
  3: [
    { action: 'Define 1–3 metrics that prove the control is working (counts, ratios, SLAs).',
      why: 'Managed tier requires the process to be measured, not just present.' },
    { action: 'Schedule a quarterly review of those metrics with the owner + a reviewer.',
      why: 'A cadence converts measurement into management.' },
    { action: 'Run at least one independent audit / sample of the control per year.',
      why: 'Self-measurement without external verification stalls at Defined.' },
  ],
  // 4 → 5: continuous improvement + benchmarking
  4: [
    { action: 'Document at least one specific improvement made in the last 12 months.',
      why: 'Optimizing tier requires evidence of "we changed something because of what we measured."' },
    { action: 'Compare your metrics against an external benchmark (industry, vendor, peer).',
      why: 'Optimizing assumes you know whether your "good" is actually good.' },
    { action: 'Set a trigger that re-opens the control for review (metric drop, incident, etc.).',
      why: 'Continuous improvement requires named triggers, not just calendar pings.' },
  ],
};

/**
 * Build the recommendation list for a single control. Returns recommendations
 * in priority order (most-impactful first) — Q-driven specifics lead, generic
 * tier rungs follow.
 */
function recommendationsFor(opts: {
  pra: number | null;
  gol: number;
  q1: AssessmentAnswer | null;
  q2: AssessmentAnswer | null;
  q3: AssessmentAnswer | null;
  q4: string | null;
}): Recommendation[] {
  const recs: Recommendation[] = [];

  // No assessment AND no score yet: prerequisite is just to score it.
  if (opts.pra == null && opts.q1 == null && opts.q2 == null && opts.q3 == null) {
    recs.push({
      id: 'unscored',
      action: 'Answer the guided assessment for this control (Q1–Q4) to set a baseline.',
      why: 'Without a Practice score we can’t generate gap-specific recommendations.',
      driver: 'unscored',
    });
    return recs;
  }

  // Q-driven specifics. Each fires when the user answered "no" or "partial"
  // — i.e., the rung they skipped is exactly what to recommend.
  const isMiss = (a: AssessmentAnswer | null) => a === 'no' || a === 'partial';

  if (isMiss(opts.q1)) {
    recs.push({
      id: 'q1',
      action: 'Document the process for this control — a one-page SOP or runbook is enough to start.',
      why: 'You answered Q1 (is there a documented process?) as ' + (opts.q1 === 'partial' ? '"Partial"' : '"No"') + '. Documentation is the rung that lifts a control out of Initial.',
      driver: 'q1_missing_docs',
    });
  }
  if (isMiss(opts.q2)) {
    recs.push({
      id: 'q2',
      action: 'Assign a named owner and log exceptions for 30 days to prove the process is followed.',
      why: 'You answered Q2 (is it consistently followed?) as ' + (opts.q2 === 'partial' ? '"Partial"' : '"No"') + '. Exception tracking is the cleanest way to demonstrate adherence.',
      driver: 'q2_not_followed',
    });
  }
  if (isMiss(opts.q3)) {
    recs.push({
      id: 'q3',
      action: 'Pick 1–3 metrics for this control and schedule a quarterly review.',
      why: 'You answered Q3 (is it measured / audited?) as ' + (opts.q3 === 'partial' ? '"Partial"' : '"No"') + '. Measurement is the rung that moves you from Defined to Managed.',
      driver: 'q3_not_measured',
    });
  }
  // Q4 specifically fires when Q1–Q3 are all yes but Q4 is empty — the only
  // missing rung to hit Optimizing.
  const allYes = opts.q1 === 'yes' && opts.q2 === 'yes' && opts.q3 === 'yes';
  if (allYes && !(opts.q4 ?? '').trim()) {
    recs.push({
      id: 'q4',
      action: 'Write one paragraph describing an improvement made to this control in the last 12 months.',
      why: 'Q1–Q3 are all "Yes" — the only rung left for Optimizing is closing the continuous-improvement loop in Q4.',
      driver: 'q4_no_improvement',
    });
  }

  // Generic tier-rung fallback. For the tier the user is currently on, emit
  // the universal asks that move them to the next tier. Caps at tier 4 (the
  // 5—6 transition doesn’t exist).
  const currentInt = Math.max(1, Math.min(4, Math.floor(opts.pra ?? 1)));
  // If we've already emitted a Q-driven version of the same rung, skip the
  // generic to avoid duplication. (Q1 covers the "write something down" rung
  // of 1→2; Q2 covers the enforcement rung of 2→3; Q3 covers measurement
  // of 3→4; Q4 covers improvement of 4→5.) When Q-driven didn't fire for
  // this rung we drop in the generic version.
  const rungs = TIER_TRANSITIONS[currentInt] ?? [];
  const haveQ1 = recs.some((r) => r.driver === 'q1_missing_docs');
  const haveQ2 = recs.some((r) => r.driver === 'q2_not_followed');
  const haveQ3 = recs.some((r) => r.driver === 'q3_not_measured');
  const haveQ4 = recs.some((r) => r.driver === 'q4_no_improvement');
  const rungCovered =
    (currentInt === 1 && haveQ1) ||
    (currentInt === 2 && haveQ2) ||
    (currentInt === 3 && haveQ3) ||
    (currentInt === 4 && haveQ4);
  if (!rungCovered) {
    for (const r of rungs) {
      recs.push({
        id: `tier-${currentInt}-${rungs.indexOf(r)}`,
        action: r.action,
        why: r.why,
        driver: 'tier_rung',
      });
    }
  }

  return recs;
}

/**
 * Build gaps for an entire framework. Walks every control in the framework
 * definition, joins with the tenant's current_scores + assessment_responses,
 * and returns only the controls where pra < gol (the brief).
 *
 * Sort order: severity desc, then gap desc, then control_id asc — so the
 * checklist reads top-to-bottom as "biggest problems first." Ties broken by
 * control id so the order is deterministic across renders.
 */
export function buildGapAnalysis(input: {
  definition: {
    groups: {
      id: string;
      name: string;
      categories: {
        id: string;
        name: string;
        controls: { id: string; outcome: string }[];
      }[];
    }[];
  };
  scoresByControl: Map<string, Pick<CurrentScore, 'pra' | 'gol' | 'prio' | 'owner'>>;
  responsesByControl: Map<string, AssessmentResponse>;
}): ControlGap[] {
  const out: ControlGap[] = [];

  for (const g of input.definition.groups) {
    for (const cat of g.categories) {
      for (const ctrl of cat.controls) {
        const score = input.scoresByControl.get(ctrl.id);
        // No goal set = the tenant hasn’t declared a target for this control,
        // so by definition there’s no "gap." Skip entirely.
        if (!score?.gol) continue;
        const gol = typeof score.gol === 'number' ? score.gol : parseFloat(String(score.gol));
        const pra = score.pra == null ? null
          : typeof score.pra === 'number' ? score.pra : parseFloat(String(score.pra));

        const gap = gol - (pra ?? 1);
        if (gap <= 0) continue;   // At or above goal — skip.

        const resp = input.responsesByControl.get(ctrl.id);
        const recs = recommendationsFor({
          pra, gol,
          q1: resp?.q1_documented ?? null,
          q2: resp?.q2_followed ?? null,
          q3: resp?.q3_measured ?? null,
          q4: resp?.q4_improvement ?? null,
        });

        out.push({
          control_id: ctrl.id,
          outcome: ctrl.outcome,
          group_id: g.id,
          group_name: g.name,
          category_id: cat.id,
          category_name: cat.name,
          pra,
          gol,
          gap: Math.round(gap * 10) / 10,
          owner: score.owner ?? null,
          prio: score.prio ?? null,
          current_tier: tierForScore(pra),
          target_tier: tierForScore(gol),
          severity: severityFromGap(gap),
          q1: resp?.q1_documented ?? null,
          q2: resp?.q2_followed ?? null,
          q3: resp?.q3_measured ?? null,
          q4: resp?.q4_improvement ?? null,
          recommendations: recs,
        });
      }
    }
  }

  const SEV_ORDER: Record<GapSeverity, number> = { critical: 0, high: 1, moderate: 2, minor: 3 };
  out.sort((a, b) => {
    if (SEV_ORDER[a.severity] !== SEV_ORDER[b.severity]) {
      return SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
    }
    if (b.gap !== a.gap) return b.gap - a.gap;
    return a.control_id.localeCompare(b.control_id);
  });

  return out;
}

/** Roll-up stats for the page KPI strip. */
export function summarizeGaps(gaps: ControlGap[]): {
  total_gaps: number;
  critical: number;
  high: number;
  moderate: number;
  minor: number;
  total_recommendations: number;
  avg_gap: number;
} {
  const total_gaps = gaps.length;
  let critical = 0, high = 0, moderate = 0, minor = 0;
  let total_recommendations = 0;
  let gapSum = 0;
  for (const g of gaps) {
    if (g.severity === 'critical') critical++;
    else if (g.severity === 'high') high++;
    else if (g.severity === 'moderate') moderate++;
    else minor++;
    total_recommendations += g.recommendations.length;
    gapSum += g.gap;
  }
  return {
    total_gaps, critical, high, moderate, minor, total_recommendations,
    avg_gap: total_gaps ? Math.round((gapSum / total_gaps) * 10) / 10 : 0,
  };
}
