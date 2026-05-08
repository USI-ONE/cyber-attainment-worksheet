import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import IrPlaybooksClient from '@/components/IrPlaybooksClient';
import type { IrPlaybook } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function IrPlansPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('ir_playbooks')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('category', { ascending: true })
    .order('name', { ascending: true });

  return (
    <main className="app-main">
      <IrPlaybooksClient initialPlaybooks={(data ?? []) as IrPlaybook[]} />
    </main>
  );
}
