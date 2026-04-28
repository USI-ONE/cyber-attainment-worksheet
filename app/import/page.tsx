import { headers } from 'next/headers';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import ImportClient from '@/components/ImportClient';
import { resolveTenant } from '@/lib/tenant';
import { createClient } from '@/lib/supabase/server';

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

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <Header tenant={tenant} frameworkLabel={'Legacy Import'} userEmail={user?.email ?? null} />
      <main className="app-main">
        <ImportClient tenantSlug={tenant.slug} />
      </main>
      <Footer tenant={tenant} />
    </>
  );
}
