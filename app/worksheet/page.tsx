import { headers } from 'next/headers';
import WorksheetView from '@/components/WorksheetView';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { CurrentScore } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function WorksheetPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const fw = await loadActiveFramework(tenant);
  if (!fw) return <main className="app-main"><div className="banner error">No framework.</div></main>;

  const supabase = createServiceRoleClient();
  const [scoresRes, docsRes] = await Promise.all([
    supabase.from('current_scores').select('*')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id),
    // Pull only metadata + linked controls — file blobs aren't needed at this layer.
    // The badge just needs (id, title, linked_control_ids).
    supabase.from('policy_documents')
      .select('id, title, version, linked_control_ids')
      .eq('tenant_id', tenant.id)
      .neq('status', 'archived'),
  ]);

  const scores: Record<string, CurrentScore> = {};
  for (const r of (scoresRes.data ?? []) as CurrentScore[]) scores[r.control_id] = r;

  // Build a control_id → [{id, title, version}] map so the worksheet can render
  // a "📄 N" badge per row without a per-row query.
  const policyByControl: Record<string, { id: string; title: string; version: string | null }[]> = {};
  for (const d of (docsRes.data ?? []) as Array<{ id: string; title: string; version: string | null; linked_control_ids: string[] }>) {
    for (const cid of d.linked_control_ids ?? []) {
      (policyByControl[cid] ||= []).push({ id: d.id, title: d.title, version: d.version });
    }
  }

  return (
    <main className="app-main">
      <WorksheetView
        tenantId={tenant.id}
        frameworkVersionId={fw.version.id}
        definition={fw.definition}
        initialScores={scores}
        policyByControl={policyByControl}
      />
    </main>
  );
}
