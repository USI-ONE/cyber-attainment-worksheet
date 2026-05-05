import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToStream } from '@react-pdf/renderer';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { computeGroupAverages, computeOverallTotals } from '@/lib/scoring';
import { DashboardReport } from '@/lib/pdf/DashboardReport';
import type { CurrentScore } from '@/lib/supabase/types';

/**
 * GET /api/report/dashboard — Streams the executive Posture Briefing PDF
 *   for the current tenant. Includes per-function table, overall stats,
 *   top remediation targets, and metadata for the cover.
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
  const [scoresRes, incTotal, incOpen, polDocs] = await Promise.all([
    supabase
      .from('current_scores')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id),
    supabase.from('incidents').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
    supabase.from('incidents').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).neq('status', 'closed'),
    supabase.from('policy_documents').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).neq('status', 'archived'),
  ]);

  const scores = (scoresRes.data ?? []) as CurrentScore[];
  // Build a control_id -> partial CurrentScore map for the scoring helpers.
  const scoreMap: Record<string, Partial<CurrentScore>> = {};
  for (const r of scores) scoreMap[r.control_id] = r;

  const groupAverages = computeGroupAverages(fw.version.definition, scoreMap);
  const totals = computeOverallTotals(groupAverages);

  // Top remediation targets: controls with the biggest Goal-Practice gap.
  // Pull individual rows so the report doesn't just show function-level avgs.
  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };
  const topGaps = scores
    .map((r) => {
      const pra = num(r.pra); const gol = num(r.gol); const pol = num(r.pol);
      const gap = pra != null && gol != null ? gol - pra : null;
      return { control_id: r.control_id, pol, pra, gol, gap };
    })
    .filter((r) => r.gap != null && r.gap > 0)
    .sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0))
    .slice(0, 12);

  const stream = await renderToStream(
    React.createElement(DashboardReport, {
      tenant,
      groupAverages,
      totals,
      topGaps,
      asOf: new Date(),
      incidentSummary: { open: incOpen.count ?? 0, total: incTotal.count ?? 0 },
      policyDocCount: polDocs.count ?? 0,
    }) as React.ReactElement,
  );

  const filename = `${slugify(tenant.slug)}-executive-briefing-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
