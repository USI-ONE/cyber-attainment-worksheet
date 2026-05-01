import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import type { Incident, IncidentSeverity, IncidentStatus } from '@/lib/supabase/types';

/**
 * GET    /api/incidents/[id] — fetch one incident (must belong to current tenant)
 * PATCH  /api/incidents/[id] — partial update
 * DELETE /api/incidents/[id] — remove incident + cascade documents
 */
export const dynamic = 'force-dynamic';

const STATUSES: readonly IncidentStatus[] = ['open', 'contained', 'closed'];
const SEVERITIES: readonly IncidentSeverity[] = ['low', 'medium', 'high', 'critical'];

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('incidents')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('not found', 404);
  return NextResponse.json({ incident: data as Incident });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  let body: Partial<Incident>;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  // Whitelist mutable fields. tenant_id and id are not user-editable; updated_at
  // is set by the trigger.
  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string') {
    const t = body.title.trim();
    if (!t) return bad('title cannot be empty');
    patch.title = t;
  }
  if (typeof body.status === 'string') {
    if (!STATUSES.includes(body.status as IncidentStatus)) return bad('invalid status');
    patch.status = body.status;
  }
  if (typeof body.severity === 'string') {
    if (!SEVERITIES.includes(body.severity as IncidentSeverity)) return bad('invalid severity');
    patch.severity = body.severity;
  }
  if ('category' in body)        patch.category        = body.category?.toString().trim() || null;
  if ('detected_at' in body)     patch.detected_at     = body.detected_at || null;
  if ('contained_at' in body)    patch.contained_at    = body.contained_at || null;
  if ('closed_at' in body)       patch.closed_at       = body.closed_at || null;
  if ('reported_by' in body)     patch.reported_by     = body.reported_by?.toString().trim() || null;
  if ('description' in body)     patch.description     = body.description?.toString() ?? null;
  if (Array.isArray(body.affected_users))     patch.affected_users     = body.affected_users;
  if (Array.isArray(body.timeline))           patch.timeline           = body.timeline;
  if (Array.isArray(body.findings))           patch.findings           = body.findings;
  if (Array.isArray(body.actions))            patch.actions            = body.actions;
  if (Array.isArray(body.recommendations))    patch.recommendations    = body.recommendations;
  if (Array.isArray(body.linked_control_ids)) patch.linked_control_ids = body.linked_control_ids;

  if (Object.keys(patch).length === 0) return bad('no patchable fields');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('incidents')
    .update(patch)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('not found', 404);
  return NextResponse.json({ ok: true, incident: data as Incident });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();

  // Pull document storage paths first so we can clear blobs, then drop the row.
  const { data: docs } = await supabase
    .from('incident_documents')
    .select('storage_path')
    .eq('incident_id', params.id)
    .eq('tenant_id', tenant.id);

  if (docs && docs.length > 0) {
    const paths = docs.map((d) => d.storage_path).filter(Boolean);
    if (paths.length > 0) {
      // Best-effort: a failure here still proceeds with the row delete; the
      // user can clean orphans from the bucket if needed.
      await supabase.storage.from('incident-documents').remove(paths);
    }
  }

  const { error } = await supabase
    .from('incidents')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
