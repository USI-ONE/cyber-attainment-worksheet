import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import PrioritiesClient from '@/components/PrioritiesClient';

export const dynamic = 'force-dynamic';

export default async function PrioritiesPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;
  const fw = await loadActiveFramework(tenant);

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('priorities')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('completed_at', { ascending: true, nullsFirst: true })
    .order('priority_level', { ascending: false })
    .order('due_date', { ascending: true, nullsFirst: false });

  const controls: { id: string; outcome: string }[] = [];
  if (fw) {
    for (const g of fw.definition.groups) {
      for (const cat of g.categories) {
        for (const c of cat.controls) controls.push({ id: c.id, outcome: c.outcome });
      }
    }
  }

  return (
    <main className="app-main">
      <PrioritiesClient initial={data ?? []} controls={controls} />
    </main>
  );
}
