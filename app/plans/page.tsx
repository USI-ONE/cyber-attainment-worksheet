import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser, canEditTenant, canAccessTenant } from '@/lib/auth';
import PlansLibraryClient, { type PlansLibraryItem } from '@/components/PlansLibraryClient';

/**
 * /plans — the "plans library" checklist for the current tenant.
 *
 * Operational counterpart to /policies. Policies say WHAT we will do
 * (rules); plans say HOW we will do it (procedures). Same UX shape.
 */
export const dynamic = 'force-dynamic';

export default async function PlansPage() {
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
    sb.from('plans_library_catalog').select('*').order('sort_order'),
    sb.from('tenant_plans').select('*').eq('tenant_id', tenant.id),
  ]);

  const stateByCode = new Map(
    (states ?? []).map((s) => [
      (s as { plan_code: string }).plan_code,
      s as PlansLibraryItem['state'],
    ]),
  );
  const items: PlansLibraryItem[] = (catalog ?? []).map((c) => {
    const cc = c as Omit<PlansLibraryItem, 'state'>;
    return { ...cc, state: stateByCode.get(cc.code) ?? null };
  });

  return (
    <main className="app-main">
      <PlansLibraryClient items={items} canEdit={canEdit} />
    </main>
  );
}
