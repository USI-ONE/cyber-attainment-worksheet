import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  listCrosswalkFrameworks,
  computeInheritedCoverage,
  type CrosswalkFramework,
  type InheritedCoverageRow,
} from '@/lib/crosswalk';
import CrosswalkClient, {
  type CrosswalkControl,
  type CrosswalkMapping,
} from '@/components/CrosswalkClient';

/**
 * Compliance crosswalk page.
 *
 * Lets the user pick a SOURCE framework (defaults to the tenant's active
 * framework, typically NIST CSF 2.0) and a TARGET framework. Renders:
 *
 *   1. A coverage roll-up: how many target controls have an inherited
 *      score from at least one mapped source control, and the inherited
 *      Practice average.
 *   2. A side-by-side control list: every TARGET control with its
 *      inherited score and the contributing SOURCE controls.
 *
 * Query params:
 *   ?source=<framework_version_id>   default: the tenant's active framework
 *   ?target=<framework_version_id>   default: the first OTHER framework
 *
 * The page is server-rendered so the heavy mapping + coverage join runs
 * once per visit rather than on every keystroke client-side.
 */
export const dynamic = 'force-dynamic';

export default async function CrosswalkPage({
  searchParams,
}: {
  searchParams: { source?: string; target?: string };
}) {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) {
    return <main className="app-main"><div className="banner error">No tenant.</div></main>;
  }

  const supabase = createServiceRoleClient();
  const frameworks = await listCrosswalkFrameworks(supabase);
  if (frameworks.length < 2) {
    return (
      <main className="app-main">
        <section className="scorecard">
          <div className="scorecard-title">Compliance Crosswalk</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            Only one framework is loaded. Crosswalk needs at least two.
          </div>
        </section>
      </main>
    );
  }

  // Resolve source + target. Default source = tenant's active framework
  // (the one tenant_frameworks points at); fall back to whichever framework
  // marked is_current. Target defaults to "the first framework that isn't
  // the source."
  const { data: tfRow } = await supabase
    .from('tenant_frameworks')
    .select('framework_version_id')
    .eq('tenant_id', tenant.id)
    .limit(1)
    .maybeSingle();
  const tenantActiveFv = (tfRow as { framework_version_id: string } | null)?.framework_version_id ?? null;

  const sourceId = searchParams.source
    ?? tenantActiveFv
    ?? frameworks[0].framework_version_id;
  const targetId = searchParams.target
    ?? frameworks.find((f) => f.framework_version_id !== sourceId)?.framework_version_id
    ?? frameworks[1].framework_version_id;

  const source = frameworks.find((f) => f.framework_version_id === sourceId);
  const target = frameworks.find((f) => f.framework_version_id === targetId);
  if (!source || !target) {
    return (
      <main className="app-main">
        <section className="scorecard">
          <div className="scorecard-title">Compliance Crosswalk</div>
          <div className="banner error">Invalid framework selection.</div>
        </section>
      </main>
    );
  }

  // Load both framework definitions so we can render control titles + group
  // them by parent. We need the full definition JSON, not just the IDs.
  const { data: fvRows } = await supabase
    .from('framework_versions')
    .select('id, definition')
    .in('id', [sourceId, targetId]);
  type DefRow = { id: string; definition: {
    groups: { id: string; name: string; categories: { id: string; name: string; controls: { id: string; outcome: string }[] }[] }[];
  } };
  const defMap = new Map<string, DefRow['definition']>();
  for (const r of (fvRows ?? []) as DefRow[]) defMap.set(r.id, r.definition);
  const sourceDef = defMap.get(sourceId);
  const targetDef = defMap.get(targetId);

  // Flatten target into a list of controls so the client can render them.
  const targetControls: CrosswalkControl[] = [];
  if (targetDef) {
    for (const g of targetDef.groups) {
      for (const cat of g.categories) {
        for (const ctrl of cat.controls) {
          targetControls.push({
            control_id: ctrl.id,
            outcome: ctrl.outcome,
            group_id: g.id,
            group_name: g.name,
            category_id: cat.id,
            category_name: cat.name,
          });
        }
      }
    }
  }

  // Source control lookup so the client can show "this row inherits from
  // PR.AA-01 — Identities and credentials are managed for authorized…"
  const sourceControlLookup: Record<string, string> = {};
  if (sourceDef) {
    for (const g of sourceDef.groups) {
      for (const cat of g.categories) {
        for (const ctrl of cat.controls) {
          sourceControlLookup[ctrl.id] = ctrl.outcome;
        }
      }
    }
  }

  // Compute coverage.
  const coverage = await computeInheritedCoverage({
    tenantId: tenant.id,
    sourceFrameworkVersionId: sourceId,
    targetFrameworkVersionId: targetId,
    supabase,
  });
  const coverageByTarget = new Map<string, InheritedCoverageRow>();
  for (const c of coverage) coverageByTarget.set(c.target_control_id, c);

  // Build the client-friendly mapping rows: target_control_id → list of
  // source contributors. (The coverage struct already has this, but we
  // also want to surface controls that have ZERO mapped sources — those
  // are the gaps.)
  const mappingsForClient: CrosswalkMapping[] = targetControls.map((t) => {
    const cov = coverageByTarget.get(t.control_id);
    return {
      target_control_id: t.control_id,
      inherited_pra: cov?.inherited_pra ?? null,
      inherited_pol: cov?.inherited_pol ?? null,
      source_count:  cov?.source_count ?? 0,
      contributors:  cov?.contributors ?? [],
    };
  });

  return (
    <main className="app-main">
      <CrosswalkClient
        frameworks={frameworks satisfies CrosswalkFramework[]}
        source={source}
        target={target}
        targetControls={targetControls}
        mappings={mappingsForClient}
        sourceControlLookup={sourceControlLookup}
      />
    </main>
  );
}
