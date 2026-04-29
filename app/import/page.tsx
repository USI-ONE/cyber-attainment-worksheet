import { headers } from 'next/headers';
import ImportClient from '@/components/ImportClient';
import { resolveTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) {
    return (
      <main className="app-main">
        <div className="banner error">
          No tenant resolved. Configure <code>TENANT_SLUG</code>.
        </div>
      </main>
    );
  }
  return (
    <main className="app-main">
      <ImportClient tenantSlug={tenant.slug} />
    </main>
  );
}
