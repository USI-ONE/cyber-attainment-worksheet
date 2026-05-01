import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import type { Incident, IncidentSeverity, IncidentStatus } from '@/lib/supabase/types';

/**
 * GET  /api/incidents — list incidents for the current tenant (newest first).
 * POST /api/incidents — create a new incident. Body fields are all optional
 *   except `title`; the rest can be filled in on the detail page.
 */
export const dynamic = 'force-dynamic';

const STATUSES: readonly IncidentStatus[] = ['open', 'contained', 'closed'];
const SEVERITIES: readonly IncidentSeverity[] = ['low', 'medium', 'high', 'critical'];

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('incidents')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('detected_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ incidents: (data ?? []) as Incident[] });
}

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  let body: Partial<Incident>;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const title = (body.title ?? '').trim();
  if (!title) return bad('title is required');

  const status: IncidentStatus = STATUSES.includes(body.status as IncidentStatus)
    ? (body.status as IncidentStatus) : 'open';
  const severity: IncidentSeverity = SEVERITIES.includes(body.severity as IncidentSeverity)
    ? (body.severity as IncidentSeverity) : 'medium';

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('incidents')
    .insert({
      tenant_id: tenant.id,
      title,
      status,
      severity,
      category: body.category?.toString().trim() || null,
      detected_at: body.detected_at || null,
      contained_at: body.contained_at || null,
      closed_at: body.closed_at || null,
      reported_by: body.reported_by?.toString().trim() || null,
      affected_users: Array.isArray(body.affected_users) ? body.affected_users : [],
      description: body.description?.toString() ?? null,
      timeline: Array.isArray(body.timeline) ? body.timeline : [],
      findings: Array.isArray(body.findings) ? body.findings : [],
      actions: Array.isArray(body.actions) ? body.actions : [],
      recommendations: Array.isArray(body.recommendations) ? body.recommendations : [],
      linked_control_ids: Array.isArray(body.linked_control_ids) ? body.linked_control_ids : [],
    })
    .select('*')
    .single();
  if (error || !data) return bad(error?.message ?? 'insert failed', 500);
  return NextResponse.json({ ok: true, incident: data as Incident });
}
