import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import RiskRegisterClient from '@/components/RiskRegisterClient';
import type { Risk, RiskTreatment, DrPlan, IrPlaybook } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function RisksPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const supabase = createServiceRoleClient();
  const [risksRes, treatRes, drRes, irRes] = await Promise.all([
    supabase.from('risks').select('*').eq('tenant_id', tenant.id)
      .order('residual_score', { ascending: false })
      .order('inherent_score', { ascending: false })
      .order('code', { ascending: true }),
    supabase.from('risk_treatments').select('*').eq('tenant_id', tenant.id)
      .order('risk_id').order('display_order'),
    supabase.from('dr_plans').select('id, name, tier').eq('tenant_id', tenant.id),
    supabase.from('ir_playbooks').select('id, name, category').eq('tenant_id', tenant.id),
  ]);

  return (
    <main className="app-main">
      <RiskRegisterClient
        initialRisks={(risksRes.data ?? []) as Risk[]}
        initialTreatments={(treatRes.data ?? []) as RiskTreatment[]}
        drPlanIndex={((drRes.data ?? []) as Pick<DrPlan, 'id' | 'name' | 'tier'>[])}
        irPlaybookIndex={((irRes.data ?? []) as Pick<IrPlaybook, 'id' | 'name' | 'category'>[])}
      />
    </main>
  );
}
