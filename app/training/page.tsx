import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import TrainingClient from '@/components/TrainingClient';
import type { TrainingCampaign, TrainingRecord } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function TrainingPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const supabase = createServiceRoleClient();
  const [campaignsRes, recordsRes] = await Promise.all([
    supabase.from('training_campaigns').select('*').eq('tenant_id', tenant.id)
      .order('scheduled_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase.from('training_records').select('*').eq('tenant_id', tenant.id)
      .order('due_date', { ascending: true, nullsFirst: false }),
  ]);

  return (
    <main className="app-main">
      <TrainingClient
        initialCampaigns={(campaignsRes.data ?? []) as TrainingCampaign[]}
        initialRecords={(recordsRes.data ?? []) as TrainingRecord[]}
      />
    </main>
  );
}
