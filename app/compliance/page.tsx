import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { listCrosswalkFrameworks } from '@/lib/crosswalk';
import {
  computeComplianceProgress,
  type ComplianceProgressSummary,
} from '@/lib/compliance-progress';
import ComplianceClient from '@/components/ComplianceClient';
import type { FrameworkDefinition } from '@/lib/supabase/types';

/**
 * /compliance — Cross-framework Compliance Progress.
 *
 * For each NON-active framework available to the platform (catalogued in
 * framework_versions), compute how much of that framework the tenant has
 * attained via inheritance from their active framework's scores + the
 * crosswalk mappings.
 *
 * Today only ISO 27001:2022 is mapped (per migration 0016). CIS / HIPAA /
 * SOC 2 plug in by adding rows to framework_mappings + framework_versions
 * — no changes to this page needed.
 *
 * The /crosswalk page is the per-control drill-down; this page is the
 * dashboard view (per-theme bars, KPI strip, gap surfacing).
 */
export const dynamic = 'force-dynamic';

export default async function CompliancePage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const fw = await loadActiveFramework(tenant);
  if (!fw) {
    return (
      <main className="app-main">
        <div className="banner error">
          No active framework. Assign a framework to this tenant on the worksheet first.
        </div>
      </main>
    );
  }

  const supabase = createServiceRoleClient();
  const catalog = await listCrosswalkFrameworks(supabase);

  // Filter out the tenant's active framework — the page shows progress
  // toward OTHER frameworks via inheritance.
  const targets = catalog.filter((f) => f.framework_version_id !== fw.version.id);

  // For each target framework, we need its definition to walk
  // groups → categories → controls. Pull them in parallel.
  const defs = await Promise.all(
    targets.map(async (t) => {
      const { data } = await supabase
        .from('framework_versions')
        .select('definition')
        .eq('id', t.framework_version_id)
        .maybeSingle();
      return { meta: t, definition: (data?.definition ?? null) as FrameworkDefinition | null };
    }),
  );

  const summaries: ComplianceProgressSummary[] = [];
  for (const { meta, definition } of defs) {
    if (!definition) continue;
    const s = await computeComplianceProgress({
      tenantId: tenant.id,
      sourceFvId: fw.version.id,
      targetFvDefinition: definition,
      targetFvMeta: meta,
      supabase,
    });
    summaries.push(s);
  }

  return (
    <main className="app-main">
      <ComplianceClient
        tenantName={tenant.display_name}
        sourceName={fw.definition.framework.display_name}
        sourceVersion={fw.version.version}
        summaries={summaries}
      />
    </main>
  );
}
