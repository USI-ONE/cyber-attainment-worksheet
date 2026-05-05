import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { SnapshotCompareReport, type CompareScore, type CompareSnapshotMeta } from '@/lib/pdf/SnapshotCompareReport';

/**
 * GET /api/report/snapshot-compare?from=<id>&to=<id|current>
 *   Generates a PDF comparing two snapshots — Practice + Goal deltas per
 *   function and per-control. The "to" param accepts the literal string
 *   "current" to compare a historical snapshot against the live state.
 *
 *   If neither query param is supplied, defaults to comparing the two
 *   most recent snapshots (or the most recent vs current if only one
 *   exists).
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

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

interface SnapRow { id: string; label: string; period: string | null; taken_at: string }

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const fw = await loadActiveFramework(tenant);
  if (!fw) return bad('no active framework');

  const params = request.nextUrl.searchParams;
  const fromId = params.get('from');
  const toId = params.get('to');

  const supabase = createServiceRoleClient();

  // Resolve which snapshots to compare. Default flow if no params: pick the
  // two most recent snapshots, or the most recent vs current if there's
  // only one to look back to.
  let resolvedFrom: SnapRow | null = null;
  let resolvedTo: SnapRow | 'current' | null = null;

  if (fromId && toId) {
    if (fromId === 'current' && toId === 'current') return bad('cannot compare current to current');
    const ids = [fromId, toId].filter((x) => x !== 'current');
    const { data: rows } = await supabase
      .from('snapshots')
      .select('id, label, period, taken_at')
      .eq('tenant_id', tenant.id)
      .in('id', ids);
    const byId = new Map(((rows ?? []) as SnapRow[]).map((r) => [r.id, r]));
    resolvedFrom = fromId === 'current' ? null : byId.get(fromId) ?? null;
    if (fromId === 'current') {
      // Current as the "from" side is allowed but unusual — keeps API symmetry.
      resolvedTo = byId.get(toId!) ?? null;
    } else {
      resolvedTo = toId === 'current' ? 'current' : byId.get(toId) ?? null;
    }
  } else {
    // Auto-pick: two most recent snapshots in chronological (asc) order.
    const { data: recent } = await supabase
      .from('snapshots')
      .select('id, label, period, taken_at')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id)
      .order('taken_at', { ascending: false })
      .limit(2);
    const arr = (recent ?? []) as SnapRow[];
    if (arr.length >= 2) { resolvedFrom = arr[1]; resolvedTo = arr[0]; }
    else if (arr.length === 1) { resolvedFrom = arr[0]; resolvedTo = 'current'; }
    else return bad('no snapshots found — capture at least one snapshot first', 404);
  }

  if (!resolvedFrom || !resolvedTo) return bad('one or both snapshots not found', 404);

  // Pull the score data for each side.
  const fetchSnapScores = async (sid: string): Promise<CompareScore[]> => {
    const { data } = await supabase
      .from('snapshot_scores')
      .select('control_id, pol, pra, gol')
      .eq('snapshot_id', sid);
    return ((data ?? []) as { control_id: string; pol: number | null; pra: number | null; gol: number | null }[])
      .map((r) => ({ control_id: r.control_id, pol: num(r.pol), pra: num(r.pra), gol: num(r.gol) }));
  };
  const fetchCurrentScores = async (): Promise<CompareScore[]> => {
    const { data } = await supabase
      .from('current_scores')
      .select('control_id, pol, pra, gol')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id);
    return ((data ?? []) as { control_id: string; pol: number | null; pra: number | null; gol: number | null }[])
      .map((r) => ({ control_id: r.control_id, pol: num(r.pol), pra: num(r.pra), gol: num(r.gol) }));
  };

  const [fromScores, toScores] = await Promise.all([
    fetchSnapScores(resolvedFrom.id),
    resolvedTo === 'current' ? fetchCurrentScores() : fetchSnapScores(resolvedTo.id),
  ]);

  const fromMeta: CompareSnapshotMeta = {
    id: resolvedFrom.id,
    label: resolvedFrom.label + (resolvedFrom.period ? ` (${resolvedFrom.period})` : ''),
    taken_at: resolvedFrom.taken_at,
  };
  const toMeta: CompareSnapshotMeta = resolvedTo === 'current'
    ? { id: 'current', label: 'Current State', taken_at: null }
    : {
        id: resolvedTo.id,
        label: resolvedTo.label + (resolvedTo.period ? ` (${resolvedTo.period})` : ''),
        taken_at: resolvedTo.taken_at,
      };

  const groups = fw.definition.groups.map((g) => ({ id: g.id, name: g.name }));

  const buffer = await renderToBuffer(
    React.createElement(SnapshotCompareReport, {
      tenant,
      fromMeta,
      toMeta,
      fromScores,
      toScores,
      groups,
      asOf: new Date(),
    }) as React.ReactElement,
  );

  const filename = `${slugify(tenant.slug)}-snapshot-compare-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
