import { redirect } from 'next/navigation';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser, isPlatformAdmin } from '@/lib/auth';
import NewTenantWizard, { type AvailableFramework } from '@/components/NewTenantWizard';

/**
 * /admin/tenants/new — single-page tenant onboarding wizard.
 *
 * Replaces the inline "New Tenant" form on /admin/tenants with a
 * richer flow that also lets the admin:
 *   - pick the active framework (NIST CSF 2.0 / ISO 27001:2022 / HIPAA …)
 *   - choose baseline-score seeding (skip / pol=3 + gol=3)
 *   - set the brand_config (primary color, logo URL)
 *   - flag as admin tenant
 *
 * The server fetches the list of available framework_versions so the
 * picker reflects whatever's in the catalog today (adding a new
 * framework migration auto-extends the wizard).
 */
export const dynamic = 'force-dynamic';

export default async function NewTenantPage() {
  const cu = await getCurrentUser();
  if (!cu) redirect('/auth/signin?redirect=/admin/tenants/new');
  if (!isPlatformAdmin(cu)) redirect('/');

  const supabase = createServiceRoleClient();
  const { data: fwRows } = await supabase
    .from('framework_versions')
    .select('id, version, framework:frameworks(slug, display_name)')
    .order('published_at', { ascending: true });

  type FwLite = { slug: string; display_name: string };
  type Row = { id: string; version: string; framework: FwLite | FwLite[] | null };
  const frameworks: AvailableFramework[] = ((fwRows ?? []) as unknown as Row[])
    .map((r) => {
      const fw = Array.isArray(r.framework) ? r.framework[0] : r.framework;
      if (!fw) return null;
      return {
        id: r.id,
        version: r.version,
        slug: fw.slug,
        display_name: fw.display_name,
      };
    })
    .filter((x): x is AvailableFramework => x !== null);

  return (
    <main className="app-main">
      <NewTenantWizard frameworks={frameworks} />
    </main>
  );
}
