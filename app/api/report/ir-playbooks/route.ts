import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { IrPlaybooksReport, type IrPlaybookRow } from '@/lib/pdf/IrPlaybooksReport';

/**
 * GET /api/report/ir-playbooks — generate the IR Playbook Binder PDF.
 * One section per active playbook with all response phases + comms +
 * escalation + evidence + regulatory clocks. Inactive (archived/draft)
 * playbooks are excluded so the binder reflects live operational
 * readiness only.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function bad(msg: string, code = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status: code, headers: { 'Content-Type': 'application/json' },
  });
}
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 80) || 'tenant';
}

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('ir_playbooks')
    .select(`id, name, category, severity_default, description,
             trigger_conditions, detection_sources,
             containment_steps, eradication_steps, recovery_steps,
             communications_plan, escalation_contacts,
             evidence_to_preserve, regulatory_notifications,
             linked_control_ids,
             last_reviewed, last_tabletop, next_review_due, status`)
    .eq('tenant_id', tenant.id)
    .order('category')
    .order('name');
  if (error) return bad(error.message, 500);

  const buffer = await renderToBuffer(
    React.createElement(IrPlaybooksReport, {
      tenant,
      playbooks: (data ?? []) as IrPlaybookRow[],
      asOf: new Date(),
    }) as React.ReactElement,
  );

  const filename = `${slugify(tenant.slug)}-ir-playbooks-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
