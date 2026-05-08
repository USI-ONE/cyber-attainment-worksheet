import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import type {
  IrPlaybook,
  IrPlaybookStatus,
  IrPlaybookSeverity,
} from '@/lib/supabase/types';

/**
 * GET    /api/ir-playbooks          — list all IR playbooks for the tenant
 * POST   /api/ir-playbooks          — create a playbook (only `name` + `category` required)
 * PATCH  /api/ir-playbooks          — update by `id` (partial)
 * DELETE /api/ir-playbooks?id=…     — remove
 *
 * Step arrays (containment_steps, eradication_steps, recovery_steps) and the
 * communications_plan / escalation_contacts / regulatory_notifications jsonb
 * fields are accepted as plain JSON arrays; we trust the client to send well-
 * formed shapes since this is a service-role-only API for now. Add stronger
 * validation when auth/RLS comes online.
 */
export const dynamic = 'force-dynamic';

const STATUSES:   readonly IrPlaybookStatus[]   = ['draft', 'active', 'archived'];
const SEVERITIES: readonly IrPlaybookSeverity[] = ['low', 'medium', 'high', 'critical'];

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function objList(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null);
}

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('ir_playbooks')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('category', { ascending: true })
    .order('name', { ascending: true });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ playbooks: (data ?? []) as IrPlaybook[] });
}

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  let body: Partial<IrPlaybook>;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const name = (body.name ?? '').trim();
  const category = (body.category ?? '').trim();
  if (!name) return bad('name is required');
  if (!category) return bad('category is required');

  const status: IrPlaybookStatus = STATUSES.includes(body.status as IrPlaybookStatus)
    ? (body.status as IrPlaybookStatus) : 'draft';
  const severity_default: IrPlaybookSeverity = SEVERITIES.includes(body.severity_default as IrPlaybookSeverity)
    ? (body.severity_default as IrPlaybookSeverity) : 'medium';

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('ir_playbooks')
    .insert({
      tenant_id: tenant.id,
      name,
      category,
      severity_default,
      description:              body.description?.toString() ?? null,
      trigger_conditions:       body.trigger_conditions?.toString() ?? null,
      detection_sources:        strList(body.detection_sources),
      containment_steps:        strList(body.containment_steps),
      eradication_steps:        strList(body.eradication_steps),
      recovery_steps:           strList(body.recovery_steps),
      communications_plan:      objList(body.communications_plan),
      escalation_contacts:      objList(body.escalation_contacts),
      evidence_to_preserve:     strList(body.evidence_to_preserve),
      regulatory_notifications: objList(body.regulatory_notifications),
      linked_control_ids:       strList(body.linked_control_ids),
      last_reviewed:            body.last_reviewed || null,
      last_tabletop:            body.last_tabletop || null,
      next_review_due:          body.next_review_due || null,
      status,
    })
    .select('*')
    .single();
  if (error || !data) return bad(error?.message ?? 'insert failed', 500);
  return NextResponse.json({ ok: true, playbook: data as IrPlaybook });
}

export async function PATCH(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  let body: Partial<IrPlaybook> & { id?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  if (!body.id) return bad('id required');

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const t = body.name.trim();
    if (!t) return bad('name cannot be empty');
    patch.name = t;
  }
  if (typeof body.category === 'string' && body.category.trim()) {
    patch.category = body.category.trim();
  }
  if (typeof body.status === 'string' && STATUSES.includes(body.status as IrPlaybookStatus))
    patch.status = body.status;
  if (typeof body.severity_default === 'string' && SEVERITIES.includes(body.severity_default as IrPlaybookSeverity))
    patch.severity_default = body.severity_default;

  if ('description'         in body) patch.description         = body.description?.toString() ?? null;
  if ('trigger_conditions'  in body) patch.trigger_conditions  = body.trigger_conditions?.toString() ?? null;
  if ('last_reviewed'       in body) patch.last_reviewed       = body.last_reviewed || null;
  if ('last_tabletop'       in body) patch.last_tabletop       = body.last_tabletop || null;
  if ('next_review_due'     in body) patch.next_review_due     = body.next_review_due || null;

  if (Array.isArray(body.detection_sources))        patch.detection_sources        = strList(body.detection_sources);
  if (Array.isArray(body.containment_steps))        patch.containment_steps        = strList(body.containment_steps);
  if (Array.isArray(body.eradication_steps))        patch.eradication_steps        = strList(body.eradication_steps);
  if (Array.isArray(body.recovery_steps))           patch.recovery_steps           = strList(body.recovery_steps);
  if (Array.isArray(body.evidence_to_preserve))     patch.evidence_to_preserve     = strList(body.evidence_to_preserve);
  if (Array.isArray(body.linked_control_ids))       patch.linked_control_ids       = strList(body.linked_control_ids);
  if (Array.isArray(body.communications_plan))      patch.communications_plan      = objList(body.communications_plan);
  if (Array.isArray(body.escalation_contacts))      patch.escalation_contacts      = objList(body.escalation_contacts);
  if (Array.isArray(body.regulatory_notifications)) patch.regulatory_notifications = objList(body.regulatory_notifications);

  if (Object.keys(patch).length === 0) return bad('no patchable fields');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('ir_playbooks')
    .update(patch)
    .eq('id', body.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('not found', 404);
  return NextResponse.json({ ok: true, playbook: data as IrPlaybook });
}

export async function DELETE(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return bad('id required');
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('ir_playbooks')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenant.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
