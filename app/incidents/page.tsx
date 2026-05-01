import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import IncidentsClient from '@/components/IncidentsClient';
import type { Incident } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function IncidentsPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('incidents')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('detected_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  return (
    <main className="app-main">
      <IncidentsClient initialIncidents={(data ?? []) as Incident[]} />
    </main>
  );
}
