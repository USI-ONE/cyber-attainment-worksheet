import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import AssessmentWizard from '@/components/AssessmentWizard';
import type { AssessmentResponse, PolicyDocument } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

interface NavInfo {
  prev: string | null;
  next: string | null;
  positionInFunction: number;
  totalInFunction: number;
  functionId: string;
  functionName: string;
  categoryName: string;
  controlOutcome: string;
}

export default async function AssessmentControlPage({
  params,
}: { params: { control_id: string } }) {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;
  const fw = await loadActiveFramework(tenant);
  if (!fw) return <main className="app-main"><div className="banner error">No active framework.</div></main>;

  // Locate the control + its position in its function. "Save & Next" should
  // walk through the same function before crossing into the next.
  let nav: NavInfo | null = null;
  for (const g of fw.definition.groups) {
    const flat = g.categories.flatMap((cat) =>
      cat.controls.map((c) => ({ ...c, categoryName: cat.name })),
    );
    const idx = flat.findIndex((c) => c.id === params.control_id);
    if (idx >= 0) {
      nav = {
        prev: idx > 0 ? flat[idx - 1].id : null,
        next: idx < flat.length - 1 ? flat[idx + 1].id : null,
        positionInFunction: idx + 1,
        totalInFunction: flat.length,
        functionId: g.id,
        functionName: g.name,
        categoryName: flat[idx].categoryName,
        controlOutcome: flat[idx].outcome,
      };
      break;
    }
  }
  if (!nav) notFound();

  const supabase = createServiceRoleClient();

  // Pull the saved response (if any) and any policy documents that are
  // linked to this control — we surface them inline as "evidence" so the
  // assessor can quickly see what backs each Yes.
  const [respRes, policyRes, scoreRes] = await Promise.all([
    supabase
      .from('assessment_responses')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id)
      .eq('control_id', params.control_id)
      .maybeSingle(),
    supabase
      .from('policy_documents')
      .select('id, title, version, owner, filename, linked_control_ids, status')
      .eq('tenant_id', tenant.id)
      .neq('status', 'archived')
      .contains('linked_control_ids', [params.control_id]),
    supabase
      .from('current_scores')
      .select('pra')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id)
      .eq('control_id', params.control_id)
      .maybeSingle(),
  ]);

  return (
    <main className="app-main">
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
        <Link href={"/assessment" as never} className="action-btn">← Back to all controls</Link>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
          {nav.functionId} · Control {nav.positionInFunction} of {nav.totalInFunction}
        </span>
      </div>
      <AssessmentWizard
        controlId={params.control_id}
        controlOutcome={nav.controlOutcome}
        functionId={nav.functionId}
        functionName={nav.functionName}
        categoryName={nav.categoryName}
        positionInFunction={nav.positionInFunction}
        totalInFunction={nav.totalInFunction}
        prevControlId={nav.prev}
        nextControlId={nav.next}
        initialResponse={(respRes.data ?? null) as AssessmentResponse | null}
        priorPracticeScore={
          scoreRes.data?.pra != null
            ? typeof scoreRes.data.pra === 'number'
              ? scoreRes.data.pra
              : parseFloat(String(scoreRes.data.pra))
            : null
        }
        linkedPolicies={(policyRes.data ?? []) as Pick<PolicyDocument, 'id' | 'title' | 'version' | 'owner' | 'filename' | 'linked_control_ids' | 'status'>[]}
      />
    </main>
  );
}
