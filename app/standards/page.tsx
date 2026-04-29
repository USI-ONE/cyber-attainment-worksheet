import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import StandardsClient from '@/components/StandardsClient';

export const dynamic = 'force-dynamic';

export default async function StandardsPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;
  const supabase = createServiceRoleClient();
  const [{ data: catalog }, { data: applied }] = await Promise.all([
    supabase.from('standards').select('*').order('display_name'),
    supabase.from('tenant_standards').select('*').eq('tenant_id', tenant.id),
  ]);
  return (
    <main className="app-main">
      <StandardsClient initialCatalog={catalog ?? []} initialApplied={applied ?? []} />
    </main>
  );
}
