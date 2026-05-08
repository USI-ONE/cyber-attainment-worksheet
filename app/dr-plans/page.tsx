import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import DrPlansClient from '@/components/DrPlansClient';
import type { DrPlan } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function DrPlansPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('dr_plans')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('tier', { ascending: true })
    .order('name', { ascending: true });

  return (
    <main className="app-main">
      <DrPlansClient initialPlans={(data ?? []) as DrPlan[]} />
    </main>
  );
}
