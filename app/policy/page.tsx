import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import PolicyClient from '@/components/PolicyClient';
import type { PolicyDocument } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function PolicyPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;
  const supabase = createServiceRoleClient();
  const [{ data: sections }, { data: documents }] = await Promise.all([
    supabase.from('policy_sections').select('*').eq('tenant_id', tenant.id)
      .order('display_order').order('created_at'),
    supabase.from('policy_documents').select('*').eq('tenant_id', tenant.id)
      .order('effective_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
  ]);
  return (
    <main className="app-main">
      <PolicyClient
        initialSections={sections ?? []}
        initialDocuments={(documents ?? []) as PolicyDocument[]}
      />
    </main>
  );
}
