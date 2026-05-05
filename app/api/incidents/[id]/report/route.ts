import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToStream } from '@react-pdf/renderer';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { IncidentReport } from '@/lib/pdf/IncidentReport';
import type { Incident, IncidentDocument } from '@/lib/supabase/types';

/**
 * GET /api/incidents/[id]/report
 *   Streams a board-ready PDF executive incident briefing for the given
 *   incident. Filename includes the tenant slug + incident title slug
 *   so it lands on the desk with a sensible name.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // pdf rendering can take a few seconds on cold start

function bad(msg: string, code = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status: code, headers: { 'Content-Type': 'application/json' },
  });
}

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'incident';
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();
  const { data: incident, error: incErr } = await supabase
    .from('incidents')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (incErr) return bad(incErr.message, 500);
  if (!incident) return bad('not found', 404);

  const { data: docs } = await supabase
    .from('incident_documents')
    .select('*')
    .eq('incident_id', params.id)
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });

  const preparedBy = incident.reported_by || tenant.display_name;
  const stream = await renderToStream(
    React.createElement(IncidentReport, {
      tenant,
      incident: incident as Incident,
      documents: (docs ?? []) as IncidentDocument[],
      preparedBy,
    }) as React.ReactElement,
  );

  const filename = `${slugify(tenant.slug)}-${slugify(incident.title)}-${new Date().toISOString().slice(0, 10)}.pdf`;

  // @react-pdf returns a Node Readable; wrap as a Web ReadableStream for the
  // Response. The Next.js fetch API expects a web stream when running on Node.
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
