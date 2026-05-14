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
  const [scoresRes, docsRes, mapRes] = await Promise.all([
    supabase.from('current_scores').select('*')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id),
    // Pull only metadata + linked controls — file blobs aren't needed at this layer.
    // The badge just needs (id, title, linked_control_ids).
    supabase.from('policy_documents')
      .select('id, title, version, linked_control_ids')
      .eq('tenant_id', tenant.id)
      .neq('status', 'archived'),
    // Bidirectional crosswalk mappings: from the active framework (CSF)
    // to anything else, plus reverse mappings stored as "other → CSF".
    // Normalize at read so each row is (csf_control_id, target_id).
    supabase.from('framework_mappings')
      .select('from_framework_version_id, from_control_id, to_framework_version_id, to_control_id, relationship')
      .or(`from_framework_version_id.eq.${fw.version.id},to_framework_version_id.eq.${fw.version.id}`),
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

  // Resolve the OTHER framework versions' display names so a hover-tip can
  // say "Also covers ISO 27001:2022 A.5.16" instead of just the bare id.
  type MapRow = { from_framework_version_id: string; from_control_id: string; to_framework_version_id: string; to_control_id: string; relationship: 'equivalent' | 'related' | 'partial' };
  const mapRows = (mapRes.data ?? []) as MapRow[];
  const otherFvIds = new Set<string>();
  for (const m of mapRows) {
    if (m.from_framework_version_id !== fw.version.id) otherFvIds.add(m.from_framework_version_id);
    if (m.to_framework_version_id   !== fw.version.id) otherFvIds.add(m.to_framework_version_id);
  }
  const fvNameById = new Map<string, string>();
  if (otherFvIds.size > 0) {
    const { data: fwsData } = await supabase
      .from('framework_versions')
      .select('id, frameworks(slug, display_name)')
      .in('id', Array.from(otherFvIds));
    type Row = { id: string; frameworks: { slug: string; display_name: string } | { slug: string; display_name: string }[] | null };
    for (const r of (fwsData ?? []) as unknown as Row[]) {
      const fwLite = Array.isArray(r.frameworks) ? r.frameworks[0] : r.frameworks;
      if (fwLite) fvNameById.set(r.id, fwLite.display_name);
    }
  }

  // Normalize each row to (csf_control_id, target_control_id, framework_name).
  // crosswalkByControl[csf_id] = [{ control_id, framework_name, relationship }, …]
  const crosswalkByControl: Record<string, { control_id: string; framework: string; relationship: 'equivalent' | 'related' | 'partial' }[]> = {};
  for (const m of mapRows) {
    const isCsfFrom = m.from_framework_version_id === fw.version.id;
    const csfId       = isCsfFrom ? m.from_control_id            : m.to_control_id;
    const otherId     = isCsfFrom ? m.to_control_id              : m.from_control_id;
    const otherFvId   = isCsfFrom ? m.to_framework_version_id    : m.from_framework_version_id;
    const frameworkName = fvNameById.get(otherFvId) ?? '';
    (crosswalkByControl[csfId] ||= []).push({
      control_id: otherId, framework: frameworkName, relationship: m.relationship,
    });
  }

  return (
    <main className="app-main">
      <WorksheetView
        tenantId={tenant.id}
        frameworkVersionId={fw.version.id}
        definition={fw.definition}
        initialScores={scores}
        policyByControl={policyByControl}
        crosswalkByControl={crosswalkByControl}
      />
    </main>
  );
}
