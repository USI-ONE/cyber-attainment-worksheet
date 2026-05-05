import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import {
  WorkPlanReport,
  type PriorityRow,
  type WorkPlanTaskRow,
} from '@/lib/pdf/WorkPlanReport';

/**
 * GET /api/report/work-plan — Combined Priorities + Work Plan executive
 *   briefing. Pulls active priorities and all tasks for the current
 *   tenant + framework, then renders the PDF with priorities sorted
 *   Critical→Low and tasks grouped by NIST CSF function.
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

  const fw = await loadActiveFramework(tenant);
  if (!fw) return bad('no active framework');

  const supabase = createServiceRoleClient();
  const [priRes, taskRes] = await Promise.all([
    supabase.from('priorities')
      .select('id, control_id, title, detail, owner, status, priority_level, due_date')
      .eq('tenant_id', tenant.id)
      .order('priority_level', { ascending: false, nullsFirst: false })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase.from('work_plan_tasks')
      .select('id, control_id, title, detail, status, owner, due_date, completed_at')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id)
      .order('control_id')
      .order('display_order')
      .order('created_at'),
  ]);

  const buffer = await renderToBuffer(
    React.createElement(WorkPlanReport, {
      tenant,
      priorities: (priRes.data ?? []) as PriorityRow[],
      tasks: (taskRes.data ?? []) as WorkPlanTaskRow[],
      asOf: new Date(),
    }) as React.ReactElement,
  );

  const filename = `${slugify(tenant.slug)}-work-plan-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
