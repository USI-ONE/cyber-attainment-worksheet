import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import EvidenceLibraryClient from '@/components/EvidenceLibraryClient';
import type {
  EvidenceArtifact, Risk, DrPlan, IrPlaybook, Incident, PolicyDocument,
} from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function EvidencePage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const supabase = createServiceRoleClient();
  // Pull artifacts plus the cross-reference indexes (id + label only) so the
  // editor can render real names next to each linked uuid.
  const [artifactsRes, risksRes, drRes, irRes, incRes, policyRes] = await Promise.all([
    supabase.from('evidence_artifacts')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('collected_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase.from('risks')
      .select('id, code, title, residual_score')
      .eq('tenant_id', tenant.id)
      .order('code'),
    supabase.from('dr_plans')
      .select('id, name, tier')
      .eq('tenant_id', tenant.id)
      .order('tier').order('name'),
    supabase.from('ir_playbooks')
      .select('id, name, category')
      .eq('tenant_id', tenant.id)
      .order('category').order('name'),
    supabase.from('incidents')
      .select('id, title, severity, status, detected_at')
      .eq('tenant_id', tenant.id)
      .order('detected_at', { ascending: false, nullsFirst: false }),
    supabase.from('policy_documents')
      .select('id, title, version, status')
      .eq('tenant_id', tenant.id)
      .neq('status', 'archived')
      .order('title'),
  ]);

  return (
    <main className="app-main">
      <EvidenceLibraryClient
        initialArtifacts={(artifactsRes.data ?? []) as EvidenceArtifact[]}
        risks={(risksRes.data ?? []) as Pick<Risk, 'id' | 'code' | 'title' | 'residual_score'>[]}
        drPlans={(drRes.data ?? []) as Pick<DrPlan, 'id' | 'name' | 'tier'>[]}
        irPlaybooks={(irRes.data ?? []) as Pick<IrPlaybook, 'id' | 'name' | 'category'>[]}
        incidents={(incRes.data ?? []) as Pick<Incident, 'id' | 'title' | 'severity' | 'status' | 'detected_at'>[]}
        policyDocs={(policyRes.data ?? []) as Pick<PolicyDocument, 'id' | 'title' | 'version' | 'status'>[]}
      />
    </main>
  );
}
