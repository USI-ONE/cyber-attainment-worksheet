import type { CurrentScore, FrameworkDefinition, FrameworkGroup } from '@/lib/supabase/types';

export interface GroupAverage {
  group_id: string;
  group_name: string;
  pol: number;
  pra: number;
  gol: number;
  pol_n: number;
  pra_n: number;
  gol_n: number;
  total: number;
}

/**
 * Compute per-group averages of pol/pra/gol scores.
 * Mirrors the computeFnAvgs() function in the legacy index.html.
 */
export function computeGroupAverages(
  definition: FrameworkDefinition,
  scores: Record<string, Partial<CurrentScore>>,
): GroupAverage[] {
  return definition.groups.map((g) => {
    let polSum = 0, polN = 0, praSum = 0, praN = 0, golSum = 0, golN = 0, total = 0;
    for (const cat of g.categories) {
      for (const ctrl of cat.controls) {
        total++;
        const r = scores[ctrl.id];
        if (r?.pol != null) { polSum += r.pol; polN++; }
        if (r?.pra != null) { praSum += r.pra; praN++; }
        if (r?.gol != null) { golSum += r.gol; golN++; }
      }
    }
    return {
      group_id: g.id,
      group_name: g.name,
      pol: polN ? polSum / polN : 0,
      pra: praN ? praSum / praN : 0,
      gol: golN ? golSum / golN : 0,
      pol_n: polN, pra_n: praN, gol_n: golN, total,
    };
  });
}

export interface OverallTotals {
  total: number;
  scored_pol: number;
  scored_pra: number;
  scored_gol: number;
  pol_avg: number | null;
  pra_avg: number | null;
  gol_avg: number | null;
  gap: number | null; // gol_avg - pra_avg
}

export function computeOverallTotals(avgs: GroupAverage[]): OverallTotals {
  let total = 0, polTot = 0, polN = 0, praTot = 0, praN = 0, golTot = 0, golN = 0;
  for (const a of avgs) {
    total += a.total;
    polTot += a.pol * a.pol_n; polN += a.pol_n;
    praTot += a.pra * a.pra_n; praN += a.pra_n;
    golTot += a.gol * a.gol_n; golN += a.gol_n;
  }
  const pol_avg = polN ? polTot / polN : null;
  const pra_avg = praN ? praTot / praN : null;
  const gol_avg = golN ? golTot / golN : null;
  return {
    total,
    scored_pol: polN, scored_pra: praN, scored_gol: golN,
    pol_avg, pra_avg, gol_avg,
    gap: pra_avg != null && gol_avg != null ? gol_avg - pra_avg : null,
  };
}

// 5-tier maturity scale (CMM-style, matching the Collision Leaders attainment worksheet)
// Tier values: 1 Initial · 2 Repeatable · 3 Defined · 4 Managed · 5 Optimizing
// Index 0 is intentionally empty so TIER_LABELS[1] returns 'Initial', etc.
export const TIER_LABELS = ['', 'Initial', 'Repeatable', 'Defined', 'Managed', 'Optimizing'];
export const TIER_COLORS = ['', '#9AAEC1', '#FCD34D', '#FBBF24', '#86D69E', '#7DD3DB'];
export const TIER_MAX = 5;
export const PRIORITY_LABELS = ['', 'Low', 'Medium', 'High', 'Critical'];
export const STATUS_OPTIONS = ['', 'Not Started', 'In Progress', 'Blocked', 'Complete'];

export const GROUP_COLORS: Record<string, { accent: string; text: string; bg: string }> = {
  GV: { accent: '#B89B5E', bg: 'linear-gradient(90deg, #2A210E 0%, #161D30 60%)', text: '#E8D29B' },
  ID: { accent: '#5B7FA8', bg: 'linear-gradient(90deg, #0E1828 0%, #161D30 60%)', text: '#A6BFDD' },
  PR: { accent: '#6F9DA8', bg: 'linear-gradient(90deg, #0E2024 0%, #161D30 60%)', text: '#B0CFD6' },
  DE: { accent: '#A89060', bg: 'linear-gradient(90deg, #221E10 0%, #161D30 60%)', text: '#D8C490' },
  RS: { accent: '#B85A5A', bg: 'linear-gradient(90deg, #281414 0%, #161D30 60%)', text: '#E69E9E' },
  RC: { accent: '#7AA088', bg: 'linear-gradient(90deg, #142420 0%, #161D30 60%)', text: '#B6D2BF' },
};

export function controlsOf(group: FrameworkGroup): { id: string; outcome: string; categoryName: string }[] {
  const out: { id: string; outcome: string; categoryName: string }[] = [];
  for (const cat of group.categories) {
    for (const c of cat.controls) {
      out.push({ id: c.id, outcome: c.outcome, categoryName: cat.name });
    }
  }
  return out;
}
