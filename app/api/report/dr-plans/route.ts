import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { DrPlansReport, type DrPlanRow } from '@/lib/pdf/DrPlansReport';

/**
 * GET /api/report/dr-plans — generate the DR Plan Binder PDF.
 * One page per active plan + a cover summary with portfolio metrics.
 * Inactive (archived/draft) plans are excluded so the binder reflects
 * the live operational picture only.
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
    .from('dr_plans')
    .select(`id, name, system_name, tier,
             rto_minutes, rpo_minutes, description,
             backup_method, backup_frequency, backup_retention,
             recovery_steps, recovery_owner, recovery_team, dependencies,
             last_tested, last_test_result, last_test_notes, next_test_due,
             linked_control_ids, status`)
    .eq('tenant_id', tenant.id)
    .order('tier')
    .order('name');
  if (error) return bad(error.message, 500);

  const buffer = await renderToBuffer(
    React.createElement(DrPlansReport, {
      tenant,
      plans: (data ?? []) as DrPlanRow[],
      asOf: new Date(),
    }) as React.ReactElement,
  );

  const filename = `${slugify(tenant.slug)}-dr-plans-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
