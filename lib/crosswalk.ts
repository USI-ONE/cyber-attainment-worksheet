/**
 * Compliance crosswalk helpers — server-side.
 *
 * The data lives in `framework_mappings` (one row per directional mapping
 * between a source and target framework_version). NIST CSF 2.0 → ISO
 * 27001:2022 was seeded in migration 0016; the table also accepts the
 * reverse direction or mappings to other frameworks (CIS, HIPAA, …) as
 * they're added.
 *
 * We treat mappings as bidirectional at QUERY time, not at storage time —
 * the seed only writes the more authoritative direction; UNION at read.
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export type CrosswalkRelationship = 'equivalent' | 'related' | 'partial';

export interface CrosswalkRow {
  from_framework_version_id: string;
  from_control_id: string;
  to_framework_version_id: string;
  to_control_id: string;
  relationship: CrosswalkRelationship;
}

export interface CrosswalkFramework {
  framework_version_id: string;
  slug: string;
  version: string;
  display_name: string;
}

/** Pull every loaded framework_version (catalog data). Used to populate
 *  the "source / target" pickers on the /crosswalk page. */
export async function listCrosswalkFrameworks(
  supabase?: SupabaseClient,
): Promise<CrosswalkFramework[]> {
  const db = supabase ?? createServiceRoleClient();
  const { data } = await db
    .from('framework_versions')
    .select('id, version, frameworks(slug, display_name)')
    .order('published_at', { ascending: true });

  // Supabase's typed result for an embedded relation returns the nested
  // object as `{ ... }[]` by default. We know it's a single FK so we read
  // .at(0) defensively. Cast through unknown to bypass the row-type's
  // strictness about array vs object shape.
  type FwLite = { slug: string; display_name: string };
  type Row = { id: string; version: string; frameworks: FwLite | FwLite[] | null };
  const rows = (data ?? []) as unknown as Row[];
  return rows
    .map((r): CrosswalkFramework | null => {
      const fw = Array.isArray(r.frameworks) ? r.frameworks[0] : r.frameworks;
      if (!fw) return null;
      return {
        framework_version_id: r.id,
        slug: fw.slug,
        version: r.version,
        display_name: fw.display_name,
      };
    })
    .filter((r): r is CrosswalkFramework => r !== null);
}

/** All mappings between two framework versions, bidirectional. The seed
 *  data only stores one direction; we UNION both directions so the
 *  consumer doesn't have to care which way the arrow points. */
export async function listMappingsBetween(
  fwAId: string,
  fwBId: string,
  supabase?: SupabaseClient,
): Promise<CrosswalkRow[]> {
  const db = supabase ?? createServiceRoleClient();
  const { data: fwd } = await db
    .from('framework_mappings')
    .select('from_framework_version_id, from_control_id, to_framework_version_id, to_control_id, relationship')
    .eq('from_framework_version_id', fwAId)
    .eq('to_framework_version_id', fwBId);
  const { data: rev } = await db
    .from('framework_mappings')
    .select('from_framework_version_id, from_control_id, to_framework_version_id, to_control_id, relationship')
    .eq('from_framework_version_id', fwBId)
    .eq('to_framework_version_id', fwAId);
  return [...(fwd ?? []), ...(rev ?? [])] as CrosswalkRow[];
}

/** For one specific source control, return every linked target control on
 *  the target framework — directionally. */
export async function listMappingsFromControl(
  fromFrameworkVersionId: string,
  fromControlId: string,
  toFrameworkVersionId: string,
  supabase?: SupabaseClient,
): Promise<CrosswalkRow[]> {
  const db = supabase ?? createServiceRoleClient();
  // Direction A: stored as (from, to).
  const { data: fwd } = await db
    .from('framework_mappings')
    .select('from_framework_version_id, from_control_id, to_framework_version_id, to_control_id, relationship')
    .eq('from_framework_version_id', fromFrameworkVersionId)
    .eq('from_control_id', fromControlId)
    .eq('to_framework_version_id', toFrameworkVersionId);
  // Direction B: stored as (to, from). Normalize to "from = our source".
  const { data: rev } = await db
    .from('framework_mappings')
    .select('from_framework_version_id, from_control_id, to_framework_version_id, to_control_id, relationship')
    .eq('from_framework_version_id', toFrameworkVersionId)
    .eq('to_framework_version_id', fromFrameworkVersionId)
    .eq('to_control_id', fromControlId);
  const flipped: CrosswalkRow[] = ((rev ?? []) as CrosswalkRow[]).map((r) => ({
    from_framework_version_id: r.to_framework_version_id,
    from_control_id:           r.to_control_id,
    to_framework_version_id:   r.from_framework_version_id,
    to_control_id:             r.from_control_id,
    relationship:              r.relationship,
  }));
  return [...((fwd ?? []) as CrosswalkRow[]), ...flipped];
}

/** Coverage computation: given a tenant's scores on the SOURCE framework,
 *  inherit a score for each TARGET control as the average of mapped-from
 *  source Practice scores. Weighted by relationship: equivalent = 1.0,
 *  related = 0.7, partial = 0.4 — so partial mappings don't dilute strong
 *  ones. Returns one row per target control with the inherited average
 *  and the source controls that produced it. */
export interface InheritedCoverageRow {
  target_control_id: string;
  inherited_pra: number | null;     // weighted average, 1..5 scale
  inherited_pol: number | null;
  source_count: number;
  contributors: { source_control_id: string; relationship: CrosswalkRelationship; pra: number | null; pol: number | null }[];
}

const RELATIONSHIP_WEIGHT: Record<CrosswalkRelationship, number> = {
  equivalent: 1.0,
  related:    0.7,
  partial:    0.4,
};

export async function computeInheritedCoverage(args: {
  tenantId: string;
  sourceFrameworkVersionId: string;
  targetFrameworkVersionId: string;
  supabase?: SupabaseClient;
}): Promise<InheritedCoverageRow[]> {
  const db = args.supabase ?? createServiceRoleClient();

  // 1. All mappings between the two framework versions, bidirectional,
  //    normalized so "from" is the SOURCE we have scores on.
  const fromFv = args.sourceFrameworkVersionId;
  const toFv   = args.targetFrameworkVersionId;
  const mappings = await listMappingsBetween(fromFv, toFv, db);
  const normalized: { source: string; target: string; relationship: CrosswalkRelationship }[] = [];
  for (const m of mappings) {
    if (m.from_framework_version_id === fromFv) {
      normalized.push({ source: m.from_control_id, target: m.to_control_id, relationship: m.relationship });
    } else {
      normalized.push({ source: m.to_control_id, target: m.from_control_id, relationship: m.relationship });
    }
  }

  // 2. Pull the tenant's CURRENT scores on the source framework.
  const { data: scores } = await db
    .from('current_scores')
    .select('control_id, pol, pra')
    .eq('tenant_id', args.tenantId)
    .eq('framework_version_id', fromFv);
  const scoreById = new Map<string, { pol: number | null; pra: number | null }>();
  for (const s of (scores ?? []) as { control_id: string; pol: number | null; pra: number | null }[]) {
    scoreById.set(s.control_id, { pol: s.pol, pra: s.pra });
  }

  // 3. Per target control: weighted-average the mapped source scores.
  const grouped = new Map<string, { source: string; relationship: CrosswalkRelationship; pra: number | null; pol: number | null }[]>();
  for (const m of normalized) {
    const arr = grouped.get(m.target) ?? [];
    const sc = scoreById.get(m.source);
    arr.push({ source: m.source, relationship: m.relationship, pra: sc?.pra ?? null, pol: sc?.pol ?? null });
    grouped.set(m.target, arr);
  }

  const out: InheritedCoverageRow[] = [];
  for (const [target, sources] of grouped) {
    const compute = (key: 'pra' | 'pol') => {
      let weightedSum = 0;
      let weightTotal = 0;
      for (const s of sources) {
        const v = s[key];
        if (v == null) continue;
        const w = RELATIONSHIP_WEIGHT[s.relationship];
        weightedSum += v * w;
        weightTotal += w;
      }
      return weightTotal > 0 ? weightedSum / weightTotal : null;
    };
    out.push({
      target_control_id: target,
      inherited_pra: compute('pra'),
      inherited_pol: compute('pol'),
      source_count: sources.length,
      contributors: sources.map((s) => ({
        source_control_id: s.source, relationship: s.relationship, pra: s.pra, pol: s.pol,
      })),
    });
  }
  return out.sort((a, b) => a.target_control_id.localeCompare(b.target_control_id));
}
