import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  const supabase = createServiceRoleClient();
  const { data: defs } = await supabase
    .from('register_definitions')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('display_order')
    .order('name');
  const ids = (defs ?? []).map((d) => d.id);
  let rows: unknown[] = [];
  if (ids.length > 0) {
    const { data } = await supabase
      .from('register_rows')
      .select('*')
      .in('register_id', ids)
      .order('display_order');
    rows = data ?? [];
  }
  return NextResponse.json({ definitions: defs ?? [], rows });
}

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (body.action === 'seed_defaults') return seedDefaults(tenant.id);
  const slug = String(body.slug ?? '').trim();
  const name = String(body.name ?? '').trim();
  if (!slug || !name) return NextResponse.json({ error: 'slug + name required' }, { status: 400 });
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from('register_definitions').insert({
    tenant_id: tenant.id,
    slug, name,
    description: body.description ?? null,
    columns: body.columns ?? [],
    display_order: body.display_order ?? 0,
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ definition: data });
}

export async function PATCH(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const allowed = ['name', 'description', 'columns', 'display_order'];
  const update: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) update[k] = body[k];
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('register_definitions').update(update)
    .eq('id', body.id).eq('tenant_id', tenant.id)
    .select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ definition: data });
}

export async function DELETE(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('register_definitions').delete().eq('id', id).eq('tenant_id', tenant.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

async function seedDefaults(tenantId: string) {
  const supabase = createServiceRoleClient();
  const { data: existing } = await supabase
    .from('register_definitions').select('slug').eq('tenant_id', tenantId);
  const haveSlugs = new Set((existing ?? []).map((r) => (r as { slug: string }).slug));

  const defaults = [
    {
      slug: 'stakeholder-registry',
      name: 'Stakeholder Registry',
      description: 'Internal and external stakeholders with cybersecurity-relevant interests.',
      display_order: 1,
      columns: [
        { key: 'name',         label: 'Name',         type: 'text' },
        { key: 'role',         label: 'Role',         type: 'text' },
        { key: 'organization', label: 'Organization', type: 'text' },
        { key: 'kind',         label: 'Kind',         type: 'select', options: ['Internal', 'External'] },
        { key: 'contact',      label: 'Contact',      type: 'text' },
        { key: 'notes',        label: 'Notes',        type: 'text' },
      ],
    },
    {
      slug: 'compliance-register',
      name: 'Compliance Register',
      description: 'Regulatory and contractual obligations with status and review cadence.',
      display_order: 2,
      columns: [
        { key: 'regulation',   label: 'Regulation',  type: 'text' },
        { key: 'status',       label: 'Status',      type: 'select', options: ['Compliant', 'In Progress', 'Gap', 'N/A'] },
        { key: 'frequency',    label: 'Frequency',   type: 'select', options: ['Monthly', 'Quarterly', 'Annual', 'Ad hoc'] },
        { key: 'last_review',  label: 'Last Review', type: 'date' },
        { key: 'next_review',  label: 'Next Review', type: 'date' },
        { key: 'owner',        label: 'Owner',       type: 'text' },
        { key: 'notes',        label: 'Notes',       type: 'text' },
      ],
    },
    {
      slug: 'vendor-risk-register',
      name: 'Vendor Risk Register',
      description: 'Third-party vendors with criticality and assessment status.',
      display_order: 3,
      columns: [
        { key: 'vendor',          label: 'Vendor',          type: 'text' },
        { key: 'service',         label: 'Service',         type: 'text' },
        { key: 'criticality',     label: 'Criticality',     type: 'select', options: ['Low', 'Medium', 'High', 'Critical'] },
        { key: 'status',          label: 'Status',          type: 'select', options: ['Assessed', 'Pending', 'Overdue'] },
        { key: 'last_assessed',   label: 'Last Assessed',   type: 'date' },
        { key: 'next_assessment', label: 'Next Assessment', type: 'date' },
        { key: 'notes',           label: 'Notes',           type: 'text' },
      ],
    },
    {
      slug: 'asset-inventory',
      name: 'Asset Inventory',
      description: 'Hardware / software / services / data assets with criticality.',
      display_order: 4,
      columns: [
        { key: 'asset',       label: 'Asset',       type: 'text' },
        { key: 'category',    label: 'Category',    type: 'select', options: ['Hardware', 'Software', 'Service', 'Data'] },
        { key: 'criticality', label: 'Criticality', type: 'select', options: ['Low', 'Medium', 'High', 'Critical'] },
        { key: 'owner',       label: 'Owner',       type: 'text' },
        { key: 'location',    label: 'Location',    type: 'text' },
        { key: 'notes',       label: 'Notes',       type: 'text' },
      ],
    },
    {
      slug: 'incident-log',
      name: 'Incident Log',
      description: 'Security incidents with severity, response, and lessons learned.',
      display_order: 5,
      columns: [
        { key: 'date',     label: 'Date',     type: 'date' },
        { key: 'incident', label: 'Incident', type: 'text' },
        { key: 'severity', label: 'Severity', type: 'select', options: ['Low', 'Medium', 'High', 'Critical'] },
        { key: 'status',   label: 'Status',   type: 'select', options: ['Open', 'Contained', 'Resolved', 'Closed'] },
        { key: 'owner',    label: 'Owner',    type: 'text' },
        { key: 'notes',    label: 'Notes',    type: 'text' },
      ],
    },
  ];

  const toInsert = defaults.filter((d) => !haveSlugs.has(d.slug)).map((d) => ({ tenant_id: tenantId, ...d }));
  if (toInsert.length === 0) return NextResponse.json({ ok: true, created: 0 });
  const { error } = await supabase.from('register_definitions').insert(toInsert);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, created: toInsert.length });
}
