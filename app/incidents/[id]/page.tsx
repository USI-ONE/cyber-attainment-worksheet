import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import IncidentEditor from '@/components/IncidentEditor';
import type { Incident, IncidentDocument } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function IncidentDetailPage({ params }: { params: { id: string } }) {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const supabase = createServiceRoleClient();
  const { data: incident } = await supabase
    .from('incidents')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!incident) notFound();

  const { data: documents } = await supabase
    .from('incident_documents')
    .select('*')
    .eq('incident_id', params.id)
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });

  return (
    <main className="app-main">
      <div style={{ marginBottom: 12, fontSize: 12 }}>
        <Link href="/incidents" className="action-btn">← All incidents</Link>
      </div>
      <IncidentEditor
        initialIncident={incident as Incident}
        initialDocuments={(documents ?? []) as IncidentDocument[]}
      />
    </main>
  );
}
