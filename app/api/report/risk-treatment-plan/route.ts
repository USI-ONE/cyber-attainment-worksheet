import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import {
  RiskTreatmentPlanReport,
  type RiskRow,
  type TreatmentRow,
} from '@/lib/pdf/RiskTreatmentPlanReport';

/**
 * GET /api/report/risk-treatment-plan — board-ready Risk Treatment Plan PDF.
 *   Pulls every risk + treatment for the tenant and hands them to the
 *   @react-pdf/renderer component, which produces:
 *     - Cover with appetite/exposure metrics
 *     - 5×5 residual heat map
 *     - Top-12 residual risks table
 *     - Per-risk treatment detail with inherent → residual movement
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
  const [riskRes, treatRes] = await Promise.all([
    supabase.from('risks')
      .select(`id, code, title, description, category, rationale,
               inherent_likelihood, inherent_impact, inherent_score,
               residual_likelihood, residual_impact, residual_score,
               treatment_strategy, owner, status, linked_control_ids`)
      .eq('tenant_id', tenant.id)
      .order('residual_score', { ascending: false })
      .order('inherent_score', { ascending: false })
      .order('code', { ascending: true }),
    supabase.from('risk_treatments')
      .select('id, risk_id, action, detail, status, owner, due_date, display_order')
      .eq('tenant_id', tenant.id)
      .order('risk_id')
      .order('display_order'),
  ]);

  const buffer = await renderToBuffer(
    React.createElement(RiskTreatmentPlanReport, {
      tenant,
      risks: (riskRes.data ?? []) as RiskRow[],
      treatments: (treatRes.data ?? []) as TreatmentRow[],
      asOf: new Date(),
    }) as React.ReactElement,
  );

  const filename = `${slugify(tenant.slug)}-risk-treatment-plan-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
