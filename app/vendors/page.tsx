import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import VendorRiskClient from '@/components/VendorRiskClient';
import type { Vendor, VendorAttestation } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function VendorsPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const supabase = createServiceRoleClient();
  const [vendorsRes, attestationsRes] = await Promise.all([
    supabase.from('vendors').select('*').eq('tenant_id', tenant.id)
      .order('criticality', { ascending: false })
      .order('name'),
    supabase.from('vendor_attestations').select('*').eq('tenant_id', tenant.id)
      .order('expires_on', { ascending: true, nullsFirst: false }),
  ]);

  return (
    <main className="app-main">
      <VendorRiskClient
        initialVendors={(vendorsRes.data ?? []) as Vendor[]}
        initialAttestations={(attestationsRes.data ?? []) as VendorAttestation[]}
      />
    </main>
  );
}
