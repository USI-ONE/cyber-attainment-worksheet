import { headers } from 'next/headers';
import Link from 'next/link';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import WorksheetView from '@/components/WorksheetView';
import type { CurrentScore } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

interface Snapshot {
  id: string;
  tenant_id: string;
  framework_version_id: string;
  label: string;
  period: string | null;
  taken_at: string;
  notes_md: string | null;
}

export default async function SnapshotEditPage({ params }: { params: { id: string } }) {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const fw = await loadActiveFramework(tenant);
  if (!fw) return <main className="app-main"><div className="banner error">No framework.</div></main>;

  const supabase = createServiceRoleClient();
  const { data: snap } = await supabase
    .from('snapshots')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!snap) {
    return (
      <main className="app-main">
        <div className="banner error">Snapshot not found, or not in this tenant.</div>
      </main>
    );
  }
  const snapshot = snap as Snapshot;

  const { data: scoreRows } = await supabase
    .from('snapshot_scores')
    .select('*')
    .eq('snapshot_id', snapshot.id);

  const scores: Record<string, CurrentScore> = {};
  for (const r of (scoreRows ?? []) as Record<string, unknown>[]) {
    const cid = r.control_id as string;
    scores[cid] = {
      tenant_id: tenant.id,
      framework_version_id: snapshot.framework_version_id,
      control_id: cid,
      pol: (r.pol as number | null) ?? null,
      pra: (r.pra as number | null) ?? null,
      gol: (r.gol as number | null) ?? null,
      prio: (r.prio as number | null) ?? null,
      owner: (r.owner as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      updated_by: null,
      updated_at: snapshot.taken_at,
    };
  }

  return (
    <main className="app-main">
      <section className="scorecard" style={{ marginBottom: 16 }}>
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Editing snapshot · {snapshot.label}</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              {snapshot.period ?? '—'} · taken {new Date(snapshot.taken_at).toLocaleString()} · edits save in place
            </div>
          </div>
          <Link href="/snapshots" className="action-btn">← All snapshots</Link>
        </div>
        {snapshot.notes_md && (
          <div style={{ color: 'var(--text-mid)', fontSize: 12, padding: '4px 0' }}>
            {snapshot.notes_md}
          </div>
        )}
        <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 8 }}>
          Editing scores here updates this snapshot only. The current worksheet (and other snapshots) are unaffected.
          Changes flow into the trend chart immediately.
        </div>
      </section>

      <WorksheetView
        tenantId={tenant.id}
        frameworkVersionId={snapshot.framework_version_id}
        definition={fw.definition}
        initialScores={scores}
        saveEndpoint="/api/snapshot-scores"
        extraSaveFields={{ snapshot_id: snapshot.id }}
      />
    </main>
  );
}
