import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { buildGapAnalysis, summarizeGaps } from '@/lib/recommendations';
import { RecommendationsReport } from '@/lib/pdf/RecommendationsReport';
import type { AssessmentResponse, CurrentScore } from '@/lib/supabase/types';

/**
 * GET /api/report/recommendations
 *
 * Renders the Practice Gap Recommendations PDF — the printable companion
 * to /recommendations. Same gap logic, same per-tier playbook, same
 * assessment-Q-driven specifics as the interactive page, so the printout
 * matches what the user reads on screen exactly.
 *
 * Runs in nodejs runtime + force-dynamic because @react-pdf/renderer is
 * CPU-bound and the tenant's scores change between requests.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 90;

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

  // Same joins as /recommendations page. Kept in lockstep so the PDF and
  // page never drift.
  const [scoresRes, respRes] = await Promise.all([
    supabase
      .from('current_scores')
      .select('control_id, pra, gol, prio, owner')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id),
    supabase
      .from('assessment_responses')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id),
  ]);

  const scoresByControl = new Map<string, Pick<CurrentScore, 'pra' | 'gol' | 'prio' | 'owner'>>();
  for (const row of (scoresRes.data ?? []) as Pick<CurrentScore, 'control_id' | 'pra' | 'gol' | 'prio' | 'owner'>[]) {
    scoresByControl.set(row.control_id, row);
  }
  const responsesByControl = new Map<string, AssessmentResponse>();
  for (const row of (respRes.data ?? []) as AssessmentResponse[]) {
    responsesByControl.set(row.control_id, row);
  }

  const gaps = buildGapAnalysis({
    definition: fw.definition,
    scoresByControl,
    responsesByControl,
  });
  const summary = summarizeGaps(gaps);

  const buffer = await renderToBuffer(
    React.createElement(RecommendationsReport, {
      tenant,
      frameworkName: fw.definition.framework.display_name,
      frameworkVersion: fw.version.version,
      gaps,
      summary,
      asOf: new Date(),
    }) as React.ReactElement,
  );

  const filename = `${slugify(tenant.slug)}-practice-gap-recommendations-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
