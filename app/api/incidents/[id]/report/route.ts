import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
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

/**
 * Coerce a jsonb / array column that might come back null or in an
 * unexpected shape. The PDF renderer calls `.length` and `.map()` on
 * every list field; one stray null crashes the whole render.
 */
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * Cap timeline rendering so a runaway timeline (e.g. a full incident
 * write-up pasted into the field, where every line becomes a row) does
 * not blow past Vercel's serverless function timeout. @react-pdf is a
 * Node-side layout engine and its per-row cost is non-trivial; in
 * practice anything past ~150 rows starts to risk a 60-second cap.
 *
 * Strategy: keep the first HALF and the last HALF, with a gap marker
 * in the middle. Executives reading the PDF still see the early signal
 * AND the closure events, which is what matters for board reporting.
 * The full timeline remains available on the incident page in TrustOS.
 */
const TIMELINE_MAX_ROWS = 120;
type TimelineEntry = { at: string; event: string };
function capTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  if (entries.length <= TIMELINE_MAX_ROWS) return entries;
  const half = Math.floor(TIMELINE_MAX_ROWS / 2);
  const omitted = entries.length - TIMELINE_MAX_ROWS;
  return [
    ...entries.slice(0, half),
    {
      at: '',
      event:
        `… ${omitted} middle entries omitted to keep the executive PDF under render limits. ` +
        `The complete timeline is available on the incident page in TrustOS.`,
    },
    ...entries.slice(-half),
  ];
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

  // Defensive coercion: the underlying columns are jsonb / text[]; in
  // legacy or partially-imported rows any of these can land as null or a
  // non-array value. The PDF template assumes arrays, so we normalize here.
  const safeIncident: Incident = {
    ...(incident as Incident),
    affected_users:     asArray<string>(incident.affected_users),
    findings:           asArray<string>(incident.findings),
    actions:            asArray<string>(incident.actions),
    recommendations:    asArray<string>(incident.recommendations),
    linked_control_ids: asArray<string>(incident.linked_control_ids),
    timeline:           capTimeline(asArray<TimelineEntry>((incident as { timeline?: unknown }).timeline)),
  };

  const preparedBy = incident.reported_by || tenant.display_name;

  try {
    // renderToBuffer is the simpler pairing for Next.js fetch-style Response —
    // returning the whole Buffer avoids the Node-Readable-vs-Web-ReadableStream
    // interop problem that bites @react-pdf in serverless. Reports run small
    // (≤ a few hundred KB) so buffering in memory is fine.
    const buffer = await renderToBuffer(
      React.createElement(IncidentReport, {
        tenant,
        incident: safeIncident,
        documents: (docs ?? []) as IncidentDocument[],
        preparedBy,
      }) as React.ReactElement,
    );

    const filename = `${slugify(tenant.slug)}-${slugify(incident.title)}-${new Date().toISOString().slice(0, 10)}.pdf`;

    // Wrap as Uint8Array — Node Buffer doesn't satisfy BodyInit in Next.js's
    // Web-Fetch types but a plain typed array does, and it's a zero-copy view
    // over the same underlying ArrayBuffer.
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    // Without this catch, a render failure would bubble up to Next's default
    // error handler and the browser would save an HTML error page as
    // <something>.pdf — i.e., "site unavailable" when you open the file.
    // Instead, emit the diagnostic as a downloadable plaintext file the user
    // can forward to their admin, AND console.error so the same diagnostic
    // shows up in Vercel function logs.
    const err = e as { message?: string; stack?: string };
    console.error('[incident-report] render failed', {
      incident_id: params.id,
      tenant_slug: tenant.slug,
      message: err?.message,
      stack: err?.stack,
    });
    const body =
      'Incident report generation failed.\n' +
      '\n' +
      `Incident:  ${incident.title}\n` +
      `Incident ID: ${params.id}\n` +
      `Tenant:    ${tenant.slug}\n` +
      `Time:      ${new Date().toISOString()}\n` +
      '\n' +
      `Error: ${err?.message ?? 'unknown error'}\n` +
      '\n' +
      'Stack:\n' +
      `${err?.stack ?? '(no stack available)'}\n` +
      '\n' +
      'Please send this file to your TrustOS administrator so the underlying issue can be diagnosed.\n';
    return new Response(body, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="incident-report-error-${params.id.slice(0, 8)}.txt"`,
        'Cache-Control': 'no-store',
      },
    });
  }
}
