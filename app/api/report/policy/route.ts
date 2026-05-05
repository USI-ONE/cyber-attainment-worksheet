import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToStream } from '@react-pdf/renderer';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { PolicyReport } from '@/lib/pdf/PolicyReport';
import type { PolicyDocument } from '@/lib/supabase/types';

/**
 * GET /api/report/policy — Streams the executive Policy Coverage briefing
 *   PDF: list of all uploaded policy documents, the controls each one
 *   backs, and the overall coverage ratio against the active framework.
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
  // Total control count comes from the framework definition. Falls back to 0
  // if no active framework (the report still renders, coverage just shows 0%).
  let totalControlCount = 0;
  if (fw) {
    for (const g of fw.version.definition.groups) {
      for (const c of g.categories) totalControlCount += c.controls.length;
    }
  }

  const supabase = createServiceRoleClient();
  const { data: docs } = await supabase
    .from('policy_documents')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('effective_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  const stream = await renderToStream(
    React.createElement(PolicyReport, {
      tenant,
      documents: (docs ?? []) as PolicyDocument[],
      totalControlCount,
      asOf: new Date(),
    }) as React.ReactElement,
  );

  const filename = `${slugify(tenant.slug)}-policy-coverage-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
