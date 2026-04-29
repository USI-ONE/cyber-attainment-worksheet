import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import KPIsClient from '@/components/KPIsClient';

export const dynamic = 'force-dynamic';

export default async function KPIsPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;
  const supabase = createServiceRoleClient();
  const { data: defs } = await supabase
    .from('kpi_definitions')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('display_order')
    .order('name');
  const ids = (defs ?? []).map((d) => d.id);
  let obs: unknown[] = [];
  if (ids.length > 0) {
    const { data } = await supabase
      .from('kpi_observations')
      .select('*')
      .in('kpi_definition_id', ids)
      .order('observed_at', { ascending: true });
    obs = data ?? [];
  }
  return (
    <main className="app-main">
      <KPIsClient initialDefs={defs ?? []} initialObs={obs as never[]} />
    </main>
  );
}
