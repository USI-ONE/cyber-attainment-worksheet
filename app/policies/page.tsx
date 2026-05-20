import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser, canEditTenant, canAccessTenant } from '@/lib/auth';
import PolicyLibraryClient, { type PolicyLibraryItem } from '@/components/PolicyLibraryClient';

/**
 * /policies — the "policy library" checklist for the current tenant.
 *
 * Distinct from /policy (the umbrella cybersecurity policy doc) and from
 * the policy_documents store (PDF artifacts that back NIST CSF scoring).
 * This page lists the standard set of policies an MSP-managed client is
 * expected to maintain, with status / version / review cadence per row.
 */
export const dynamic = 'force-dynamic';

export default async function PoliciesPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) {
    return <main className="app-main"><div className="banner error">No tenant.</div></main>;
  }

  const cu = await getCurrentUser();
  if (!canAccessTenant(cu, tenant.id)) {
    return <main className="app-main"><div className="banner error">You don&apos;t have access to this tenant.</div></main>;
  }
  const canEdit = canEditTenant(cu, tenant.id);

  const sb = createServiceRoleClient();
  const [{ data: catalog }, { data: states }] = await Promise.all([
    sb.from('policy_library_catalog').select('*').order('sort_order'),
    sb.from('tenant_policies').select('*').eq('tenant_id', tenant.id),
  ]);

  const stateByCode = new Map(
    (states ?? []).map((s) => [
      (s as { policy_code: string }).policy_code,
      s as PolicyLibraryItem['state'],
    ]),
  );
  const items: PolicyLibraryItem[] = (catalog ?? []).map((c) => {
    const cc = c as Omit<PolicyLibraryItem, 'state'>;
    return { ...cc, state: stateByCode.get(cc.code) ?? null };
  });

  return (
    <main className="app-main">
      <PolicyLibraryClient items={items} canEdit={canEdit} />
    </main>
  );
}
