import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import SnapshotsClient from '@/components/SnapshotsClient';

export const dynamic = 'force-dynamic';

interface SnapshotRow {
  id: string;
  label: string;
  period: string | null;
  taken_at: string;
  notes_md: string | null;
  framework_version_id: string;
}

export default async function SnapshotsPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('snapshots')
    .select('id, label, period, taken_at, notes_md, framework_version_id')
    .eq('tenant_id', tenant.id)
    .order('taken_at', { ascending: false });

  return (
    <main className="app-main">
      <SnapshotsClient initialSnapshots={(data ?? []) as SnapshotRow[]} />
    </main>
  );
}
