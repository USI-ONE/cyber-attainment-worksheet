import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import RegistersClient from '@/components/RegistersClient';

export const dynamic = 'force-dynamic';

export default async function RegistersPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;
  const supabase = createServiceRoleClient();
  const { data: defs } = await supabase
    .from('register_definitions').select('*').eq('tenant_id', tenant.id)
    .order('display_order').order('name');
  const ids = (defs ?? []).map((d) => d.id);
  let rows: unknown[] = [];
  if (ids.length > 0) {
    const { data } = await supabase
      .from('register_rows').select('*').in('register_id', ids).order('display_order');
    rows = data ?? [];
  }
  return (
    <main className="app-main">
      <RegistersClient initialDefs={defs ?? []} initialRows={rows as never[]} />
    </main>
  );
}
