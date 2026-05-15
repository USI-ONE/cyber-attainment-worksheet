/**
 * Cross-framework compliance progress.
 *
 * For each non-active framework available to the platform (ISO 27001:2022,
 * eventually CIS / HIPAA / SOC 2), compute how much of the framework the
 * tenant has "attained" through their existing scores on the active
 * framework + the crosswalk mappings.
 *
 * Attainment definition (uses the same Defined-tier threshold as the
 * NIST CSF attainment dashboard):
 *   - An inherited Practice score >= 3.0 counts as attained.
 *   - 0 < score < 3.0 counts as below-threshold.
 *   - No score at all (no mapping OR mapped source controls all null PRA)
 *     counts as unmeasured.
 *
 * The threshold is hard-coded to 3.0 ("Defined" / NIST CSF Tier 3
 * "Repeatable") today — the tier most audits use as the compliance
 * baseline. If a tenant wants a different threshold later, we'd promote
 * this to a configurable column on tenants.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeInheritedCoverage, type InheritedCoverageRow } from '@/lib/crosswalk';
import type { FrameworkDefinition } from '@/lib/supabase/types';

export const ATTAINMENT_THRESHOLD = 3.0;

/** Per-theme (top-level group in the target framework) rollup. */
export interface ThemeProgress {
  group_id: string;
  group_name: string;
  total: number;
  attained: number;
  below: number;
  unmeasured: number;
  percent: number;
  /** Average inherited PRA over the theme's mapped controls. Null when
   *  no control in the theme has any contributor with a PRA. */
  avg_inherited_pra: number | null;
}

/** Per-control inherited row, enriched with the framework metadata
 *  needed to render it in a list view. */
export interface TargetControlRow {
  control_id: string;
  outcome: string;
  group_id: string;
  group_name: string;
  category_id: string;
  category_name: string;
  inherited_pra: number | null;
  inherited_pol: number | null;
  source_count: number;
  status: 'attained' | 'below' | 'unmeasured';
}

export interface ComplianceProgressSummary {
  framework: {
    framework_version_id: string;
    slug: string;
    version: string;
    display_name: string;
  };
  overall: {
    total: number;
    attained: number;
    below: number;
    unmeasured: number;
    percent: number;
    avg_inherited_pra: number | null;
  };
  themes: ThemeProgress[];
  /** Every target control, sorted by inherited_pra desc (gaps last). */
  controls: TargetControlRow[];
}

function classify(pra: number | null): TargetControlRow['status'] {
  if (pra == null) return 'unmeasured';
  if (pra >= ATTAINMENT_THRESHOLD) return 'attained';
  return 'below';
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = nums.reduce((a, b) => a + b, 0);
  return Math.round((s / nums.length) * 100) / 100;
}

/**
 * Build the per-control rows + theme rollups for one target framework.
 *
 * @param tenantId            tenant we're scoring for
 * @param sourceFvId          tenant's active framework version (the SOURCE
 *                            of inherited scores)
 * @param targetFvDefinition  framework definition for the target (gives
 *                            us the groups → categories → controls walk)
 * @param targetFvMeta        catalog metadata for the target ({ id, slug,
 *                            version, display_name }) — used in the
 *                            returned summary
 * @param supabase            optional client (service-role by default)
 */
export async function computeComplianceProgress(args: {
  tenantId: string;
  sourceFvId: string;
  targetFvDefinition: FrameworkDefinition;
  targetFvMeta: {
    framework_version_id: string;
    slug: string;
    version: string;
    display_name: string;
  };
  supabase?: SupabaseClient;
}): Promise<ComplianceProgressSummary> {
  const coverage = await computeInheritedCoverage({
    tenantId: args.tenantId,
    sourceFrameworkVersionId: args.sourceFvId,
    targetFrameworkVersionId: args.targetFvMeta.framework_version_id,
    supabase: args.supabase,
  });
  const byControl = new Map<string, InheritedCoverageRow>();
  for (const c of coverage) byControl.set(c.target_control_id, c);

  // Walk the target framework definition so the output reflects the
  // framework's canonical control ordering (groups → categories → controls).
  // Controls with no mapping still appear, surfaced as unmeasured.
  const controls: TargetControlRow[] = [];
  const themes: ThemeProgress[] = [];
  let oTotal = 0, oAttained = 0, oBelow = 0, oUnmeasured = 0;
  const overallPras: number[] = [];

  for (const g of args.targetFvDefinition.groups) {
    let tTotal = 0, tAttained = 0, tBelow = 0, tUnmeasured = 0;
    const themePras: number[] = [];
    for (const cat of g.categories) {
      for (const ctrl of cat.controls) {
        const cov = byControl.get(ctrl.id);
        const inherited_pra = cov?.inherited_pra ?? null;
        const inherited_pol = cov?.inherited_pol ?? null;
        const source_count = cov?.source_count ?? 0;
        const status = classify(inherited_pra);
        controls.push({
          control_id: ctrl.id,
          outcome: ctrl.outcome,
          group_id: g.id,
          group_name: g.name,
          category_id: cat.id,
          category_name: cat.name,
          inherited_pra,
          inherited_pol,
          source_count,
          status,
        });
        tTotal += 1; oTotal += 1;
        if (status === 'attained') { tAttained += 1; oAttained += 1; }
        else if (status === 'below') { tBelow += 1; oBelow += 1; }
        else { tUnmeasured += 1; oUnmeasured += 1; }
        if (inherited_pra != null) {
          themePras.push(inherited_pra);
          overallPras.push(inherited_pra);
        }
      }
    }
    themes.push({
      group_id: g.id,
      group_name: g.name,
      total: tTotal,
      attained: tAttained,
      below: tBelow,
      unmeasured: tUnmeasured,
      percent: tTotal === 0 ? 0 : Math.round((tAttained / tTotal) * 1000) / 10,
      avg_inherited_pra: avg(themePras),
    });
  }

  // Sort detail list by inherited_pra desc (gaps last) so the table reads
  // top-down as "best coverage first" — most useful for the "what are we
  // already covering well" question, with gaps clearly accumulating at the
  // bottom.
  controls.sort((a, b) => {
    const av = a.inherited_pra ?? -1;
    const bv = b.inherited_pra ?? -1;
    if (av !== bv) return bv - av;
    return a.control_id.localeCompare(b.control_id);
  });

  return {
    framework: args.targetFvMeta,
    overall: {
      total: oTotal,
      attained: oAttained,
      below: oBelow,
      unmeasured: oUnmeasured,
      percent: oTotal === 0 ? 0 : Math.round((oAttained / oTotal) * 1000) / 10,
      avg_inherited_pra: avg(overallPras),
    },
    themes,
    controls,
  };
}
