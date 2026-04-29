import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import PolicyClient from '@/components/PolicyClient';

export const dynamic = 'force-dynamic';

export default async function PolicyPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('policy_sections').select('*').eq('tenant_id', tenant.id)
    .order('display_order').order('created_at');
  return (
    <main className="app-main">
      <PolicyClient initialSections={data ?? []} />
    </main>
  );
}
