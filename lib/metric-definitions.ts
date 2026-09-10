/**
 * Canonical definitions + calculations for every metric surfaced on the
 * scorecard (main dashboard) and its component sub-pages.
 *
 * Consumed by:
 *   - components/InfoIcon.tsx (hover tooltip on each metric label)
 *   - app/definitions/page.tsx (full glossary page)
 *
 * When you add a new metric to the UI, add its definition here so the
 * "i" tooltip and the /definitions page pick it up automatically.
 */

export interface MetricDefinition {
  /** Stable id used by <InfoIcon metricId="..." />. Kebab-case. */
  id: string;
  /** Display name (matches the on-screen label). */
  label: string;
  /** Which section of /definitions this metric groups under. */
  category:
    | 'Portfolio Averages'
    | 'Compliance Attainment'
    | 'Per-Function Metrics'
    | 'Per-Control Scores'
    | 'Practice Assessment'
    | 'Maturity Tiers';
  /** One-sentence plain-English answer to "what does this number mean?". */
  definition: string;
  /** Exact formula (rendered in a <code>). Free-form; keep it concise. */
  formula?: string;
  /** How to read it: range, direction (higher = better?), edge cases. */
  interpretation?: string;
  /** Where the number is computed in the codebase, for auditors. */
  source_ref?: string;
}

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  // =========================================================================
  // Portfolio Averages — the four KPI tiles at the top of the dashboard.
  // =========================================================================

  'avg-policy': {
    id: 'avg-policy',
    label: 'Avg Policy',
    category: 'Portfolio Averages',
    definition:
      'Average Policy score across all controls that have a Policy value set. Policy measures how well a control is documented — written standards, approved SOPs, versioned artifacts.',
    formula: 'avg_policy = Σ pol_i / N_pol_scored',
    interpretation:
      'Range 1.0–5.0. Higher = more of your controls have documented, versioned, approved policy behind them. Controls with no Policy value are excluded from the denominator.',
    source_ref: 'lib/scoring.ts · computeOverallTotals()',
  },

  'avg-practice': {
    id: 'avg-practice',
    label: 'Avg Practice',
    category: 'Portfolio Averages',
    definition:
      'Average Practice score across all controls that have a Practice value set. Practice measures the real-world implementation — is the control actually being executed and evolving over time?',
    formula: 'avg_practice = Σ pra_i / N_pra_scored',
    interpretation:
      'Range 1.0–5.0. This is the number auditors and boards care about most — it is what you actually do, not what you promise. Practice tends to lag Policy in most tenants.',
    source_ref: 'lib/scoring.ts · computeOverallTotals()',
  },

  'avg-goal': {
    id: 'avg-goal',
    label: 'Avg Goal',
    category: 'Portfolio Averages',
    definition:
      'Average Goal (target) tier the organization has committed to across scored controls. Set on the Worksheet, control-by-control.',
    formula: 'avg_goal = Σ gol_i / N_gol_scored',
    interpretation:
      'Range 1.0–5.0. This is a policy decision, not a measurement — it represents the maturity level the organization aims to attain, weighted by how many controls have a goal set.',
    source_ref: 'lib/scoring.ts · computeOverallTotals()',
  },

  'gap-to-goal': {
    id: 'gap-to-goal',
    label: 'Gap to Goal',
    category: 'Portfolio Averages',
    definition:
      'Portfolio-wide distance between where the organization is (Practice) and where it committed to be (Goal). Positive = below target, negative = above target.',
    formula: 'gap = avg_goal − avg_practice',
    interpretation:
      'Range roughly −4.0 to +4.0. A gap of 0 means the organization has, on average, exactly hit the maturity targets it set. A gap of +1.0 means it is one full tier below where it wants to be.',
    source_ref: 'lib/scoring.ts · computeOverallTotals()',
  },

  // =========================================================================
  // Compliance Attainment — the bar-chart panel below the KPI tiles.
  // =========================================================================

  'overall-attainment': {
    id: 'overall-attainment',
    label: 'Overall Attainment %',
    category: 'Compliance Attainment',
    definition:
      'Percentage of goaled controls that have been attained — Practice meets or exceeds the Goal. Only controls with a Goal set are counted in the denominator (you cannot measure attainment against a target you never set).',
    formula:
      'attainment_% = (# controls where pra ≥ gol) / (# controls where gol is set) × 100',
    interpretation:
      'Range 0–100%. A control with a goal but no Practice score yet is counted as "not attained" (it is in the denominator but not the numerator). Controls without a goal are excluded from both.',
    source_ref: 'lib/attainment.ts · computeAttainment()',
  },

  'attained-controls': {
    id: 'attained-controls',
    label: 'Attained (n)',
    category: 'Compliance Attainment',
    definition:
      'Count of controls where the current Practice score is greater than or equal to the Goal score.',
    formula: 'attained = count(pra ≥ gol AND gol is set)',
    interpretation:
      'Higher is better. A control does not have to reach a specific tier to be "attained" — it just has to meet whatever target the organization set for it.',
    source_ref: 'lib/attainment.ts · computeOne()',
  },

  'awaiting-practice': {
    id: 'awaiting-practice',
    label: 'Awaiting Practice score',
    category: 'Compliance Attainment',
    definition:
      'Controls that have a Goal set but no Practice score recorded yet — the target exists but no measurement.',
    formula: 'awaiting = count(gol is set AND pra is null)',
    interpretation:
      'Actionable metric — this is the queue for the Practice Assessment. Every "awaiting" control counts against attainment until the Practice score is entered.',
    source_ref: 'lib/attainment.ts · computeOne()',
  },

  'below-goal': {
    id: 'below-goal',
    label: 'Below Goal (n)',
    category: 'Compliance Attainment',
    definition:
      'Controls where a Practice score exists but is strictly below the Goal — measured, but short of the target.',
    formula: 'below = count(pra is set AND pra < gol)',
    interpretation:
      'These are the controls the Recommendations page will prioritize. Each one has both a real measurement and a real gap, so the improvement plan writes itself.',
    source_ref: 'lib/attainment.ts · computeOne()',
  },

  'tier-gap-avg': {
    id: 'tier-gap-avg',
    label: 'Avg Tier Gap',
    category: 'Compliance Attainment',
    definition:
      'Average shortfall (in maturity tiers) across the controls that are below goal. Excludes attained controls entirely so the number reflects the tightness of the misses, not the overall picture.',
    formula: 'tier_gap_avg = Σ (gol − pra) / N_below   (only where pra < gol)',
    interpretation:
      'Range 0.1–4.0. A tier-gap of 0.4 means the below-goal controls are on average less than half a tier short — usually one or two focused interventions away. 2.0+ means a structural gap.',
    source_ref: 'lib/attainment.ts · computeOne()',
  },

  // =========================================================================
  // Per-Function Metrics — the Executive Scorecard table + progress bars.
  // =========================================================================

  'function-policy': {
    id: 'function-policy',
    label: 'Function · Policy',
    category: 'Per-Function Metrics',
    definition:
      'Average Policy score scoped to one NIST CSF function (GV / ID / PR / DE / RS / RC). Same math as Avg Policy but restricted to that function\'s controls.',
    formula: 'fn_policy = Σ pol_i / N_pol_scored   (i ∈ function)',
    interpretation:
      'Range 1.0–5.0. Use this to spot which function is under-documented — a low Function Policy with a high Function Practice means the work is happening but not written down.',
    source_ref: 'lib/scoring.ts · computeGroupAverages()',
  },

  'function-practice': {
    id: 'function-practice',
    label: 'Function · Practice',
    category: 'Per-Function Metrics',
    definition:
      'Average Practice score scoped to one NIST CSF function. Measures how mature the actual implementation is inside that function.',
    formula: 'fn_practice = Σ pra_i / N_pra_scored   (i ∈ function)',
    interpretation:
      'Range 1.0–5.0. The single most representative number for how well a function operates day-to-day.',
    source_ref: 'lib/scoring.ts · computeGroupAverages()',
  },

  'function-goal': {
    id: 'function-goal',
    label: 'Function · Goal',
    category: 'Per-Function Metrics',
    definition:
      'Average Goal (target) tier scoped to one NIST CSF function. Reflects how ambitious the organization has committed to be inside that function.',
    formula: 'fn_goal = Σ gol_i / N_gol_scored   (i ∈ function)',
    interpretation:
      'Range 1.0–5.0. A high Function Goal with a low Function Practice signals over-commitment; the reverse signals under-commitment.',
    source_ref: 'lib/scoring.ts · computeGroupAverages()',
  },

  'function-gap': {
    id: 'function-gap',
    label: 'Function · Gap',
    category: 'Per-Function Metrics',
    definition:
      'Practice-to-Goal gap for one function. Positive = below target inside this function; negative = exceeding target.',
    formula: 'fn_gap = fn_goal − fn_practice',
    interpretation:
      'Compare across functions to see where the biggest maturity debt lives. Functions with high gaps are natural candidates for the next 30-Day Priorities cycle.',
    source_ref: 'components/SummaryDashboard.tsx · FunctionTable()',
  },

  'function-scored': {
    id: 'function-scored',
    label: 'Function · Scored',
    category: 'Per-Function Metrics',
    definition:
      'Ratio of controls in the function that have a Practice score to the total number of controls in the function.',
    formula: 'fn_scored = "N_pra_scored / total"   (formatted "X/Y")',
    interpretation:
      'Coverage indicator. A low coverage ratio means the function\'s averages are speaking for a small sample — treat the numbers as directional, not definitive, until more controls are assessed.',
    source_ref: 'components/SummaryDashboard.tsx · FunctionTable()',
  },

  'function-attainment': {
    id: 'function-attainment',
    label: 'Function · Attainment %',
    category: 'Per-Function Metrics',
    definition:
      'Percentage of one function\'s goaled controls that have been attained. Same rule as Overall Attainment, but scoped to a single function.',
    formula:
      'fn_attainment_% = (# in-function controls where pra ≥ gol) / (# in-function controls where gol is set) × 100',
    interpretation:
      'A high Overall % can mask a weak function — always scan the per-function bars for outliers before declaring the program healthy.',
    source_ref: 'lib/attainment.ts · computeOne()',
  },

  // =========================================================================
  // Per-Control Scores — the 3-column model the whole platform is built on.
  // =========================================================================

  'policy-score': {
    id: 'policy-score',
    label: 'Policy Score (per control)',
    category: 'Per-Control Scores',
    definition:
      'CMM-style maturity score for the documentation behind a control. Set on the Worksheet or inferred from the Assessment.',
    formula: '1.0–5.0 in half-step increments (0.5 granularity)',
    interpretation:
      '1 = no documentation. 3 = written policy, versioned, approved. 5 = policy is continuously improved based on measurement.',
    source_ref: 'lib/scoring.ts · TIER_LABELS',
  },

  'practice-score': {
    id: 'practice-score',
    label: 'Practice Score (per control)',
    category: 'Per-Control Scores',
    definition:
      'CMM-style maturity score for the real-world execution of a control. Computed from the guided Practice Assessment or set directly on the Worksheet.',
    formula:
      'From Assessment: score = 1 + 3 × (Σ item_value / N)   where no=0, partial=0.5, yes=1.\n' +
      'Bonus: all items = yes AND evidence narrative filled → score = 5.0 (Optimizing).',
    interpretation:
      'Range 1.0–5.0. The Assessment produces scores in 1.0–4.0 by default; the 5.0 tier is reserved for controls with all-yes answers AND a written continuous-improvement narrative. Half-steps (2.5, 3.5, …) are allowed if scoring directly on the worksheet.',
    source_ref: 'lib/assessment.ts · computePracticeScore()',
  },

  'goal-score': {
    id: 'goal-score',
    label: 'Goal Score (per control)',
    category: 'Per-Control Scores',
    definition:
      'The maturity tier the organization has committed to reach on this control. A management decision, not a measurement — set on the Worksheet.',
    formula: '1.0–5.0 in half-step increments (0.5 granularity)',
    interpretation:
      'A control with no Goal set is excluded from all attainment calculations. Set a Goal on every control the organization intends to be evaluated on.',
    source_ref: 'lib/scoring.ts · TIER_VALUES',
  },

  // =========================================================================
  // Practice Assessment — the guided questionnaire\'s scoring detail.
  // =========================================================================

  'assessment-item-answer': {
    id: 'assessment-item-answer',
    label: 'Assessment Item Value',
    category: 'Practice Assessment',
    definition:
      'Numeric weight each Yes/Partial/No answer contributes to a control\'s computed Practice score.',
    formula: 'yes = 1.0,   partial = 0.5,   no = 0.0',
    interpretation:
      'Every question inside a control\'s questionnaire contributes independently. There is no gating — a Partial on Q3 lifts the score whether Q1 was Yes or No.',
    source_ref: 'lib/assessment.ts · computePracticeScore()',
  },

  'assessment-optimizing-bonus': {
    id: 'assessment-optimizing-bonus',
    label: 'Optimizing Tier Bonus',
    category: 'Practice Assessment',
    definition:
      'Special rule that lifts a control\'s computed Practice score to 5.0 (Optimizing) only when every questionnaire item is Yes AND the evidence narrative is populated.',
    formula: 'if (all_items_yes AND evidence_narrative_present) → score = 5.0',
    interpretation:
      'The evidence-narrative requirement protects the 5.0 tier from being gamed — Optimizing means the tenant not only executes flawlessly, but can point to a specific improvement made in the last 12 months.',
    source_ref: 'lib/assessment.ts · computePracticeScore()',
  },

  // =========================================================================
  // Maturity Tiers — the 1-5 CMM ladder used across every score.
  // =========================================================================

  'tier-1-initial': {
    id: 'tier-1-initial',
    label: 'Tier 1 · Initial',
    category: 'Maturity Tiers',
    definition:
      'No documented process. Work happens ad-hoc, dependent on individual heroics. No repeatable behavior.',
    formula: 'score ∈ [1.0, 1.75)',
    interpretation:
      'This is the default for any control the organization has never formally addressed. Not a badge of failure — it is the honest starting point.',
    source_ref: 'lib/scoring.ts · TIER_LABELS',
  },

  'tier-2-repeatable': {
    id: 'tier-2-repeatable',
    label: 'Tier 2 · Repeatable',
    category: 'Maturity Tiers',
    definition:
      'A process exists in writing somewhere (SOP, runbook, note) but is informal and inconsistently followed. The knowledge lives with individuals more than in the system.',
    formula: 'score ∈ [1.75, 2.75)',
    interpretation:
      'The single rung most tenants sit on for the majority of their controls before formal program work begins.',
    source_ref: 'lib/scoring.ts · TIER_LABELS',
  },

  'tier-3-defined': {
    id: 'tier-3-defined',
    label: 'Tier 3 · Defined',
    category: 'Maturity Tiers',
    definition:
      'The process is a versioned, owned, approved artifact and is consistently followed. Exceptions are tracked, not accidental.',
    formula: 'score ∈ [2.75, 3.75)',
    interpretation:
      'Defined is a defensible baseline for most cyber-insurance and MSP-tier compliance postures.',
    source_ref: 'lib/scoring.ts · TIER_LABELS',
  },

  'tier-4-managed': {
    id: 'tier-4-managed',
    label: 'Tier 4 · Managed',
    category: 'Maturity Tiers',
    definition:
      'Defined AND measured. Metrics exist for the control, there is a review cadence, and at least one independent audit or sample happens per year.',
    formula: 'score ∈ [3.75, 4.75)',
    interpretation:
      'Managed is what most Tier-1 client audits (SOC 2, HIPAA compliance attestation) expect to see.',
    source_ref: 'lib/scoring.ts · TIER_LABELS',
  },

  'tier-5-optimizing': {
    id: 'tier-5-optimizing',
    label: 'Tier 5 · Optimizing',
    category: 'Maturity Tiers',
    definition:
      'Managed AND continuously improved. The organization can point to a specific change made in the last 12 months that came from a measurement — not from a bad incident.',
    formula: 'score ≥ 4.75',
    interpretation:
      'Reserved for controls the organization actively invests in — the differentiators. Not every control should be Optimizing; that is not what CMM asks of you.',
    source_ref: 'lib/scoring.ts · TIER_LABELS',
  },
};

/** All metrics, in the order they should appear on the /definitions page. */
export const METRIC_ORDER: string[] = [
  // Portfolio Averages
  'avg-policy', 'avg-practice', 'avg-goal', 'gap-to-goal',
  // Compliance Attainment
  'overall-attainment', 'attained-controls', 'awaiting-practice',
  'below-goal', 'tier-gap-avg',
  // Per-Function Metrics
  'function-policy', 'function-practice', 'function-goal',
  'function-gap', 'function-scored', 'function-attainment',
  // Per-Control Scores
  'policy-score', 'practice-score', 'goal-score',
  // Practice Assessment
  'assessment-item-answer', 'assessment-optimizing-bonus',
  // Maturity Tiers
  'tier-1-initial', 'tier-2-repeatable', 'tier-3-defined',
  'tier-4-managed', 'tier-5-optimizing',
];

/** Category order for the /definitions page section headers. */
export const METRIC_CATEGORY_ORDER: MetricDefinition['category'][] = [
  'Portfolio Averages',
  'Compliance Attainment',
  'Per-Function Metrics',
  'Per-Control Scores',
  'Practice Assessment',
  'Maturity Tiers',
];
