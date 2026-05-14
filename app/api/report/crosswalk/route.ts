import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { computeInheritedCoverage } from '@/lib/crosswalk';
import { CrosswalkReport, type CrosswalkTargetControl } from '@/lib/pdf/CrosswalkReport';

/**
 * GET /api/report/crosswalk?source=<fwv_id>&target=<fwv_id>
 *
 * Generates the Compliance Crosswalk PDF — every target-framework
 * control with its inherited Practice score from the chosen source
 * framework, plus a per-control breakdown of contributing source
 * controls. Same data the /crosswalk page renders interactively;
 * this is the auditor-ready printable.
 *
 * Defaults when query params are omitted:
 *   source = the tenant's active framework_version (typically NIST CSF 2.0)
 *   target = the first framework_version that ISN'T the source
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

  const url = new URL(request.url);
  const sourceParam = url.searchParams.get('source');
  const targetParam = url.searchParams.get('target');

  const supabase = createServiceRoleClient();

  // Pull every framework version with its display name so we can resolve
  // defaults + render names in the PDF without a second round trip.
  const { data: fvRows } = await supabase
    .from('framework_versions')
    .select('id, version, definition, frameworks(slug, display_name)')
    .order('published_at', { ascending: true });

  type FwLite = { slug: string; display_name: string };
  type Row = {
    id: string; version: string;
    definition: {
      groups: { id: string; name: string; categories: { id: string; name: string; controls: { id: string; outcome: string }[] }[] }[];
    };
    frameworks: FwLite | FwLite[] | null;
  };
  const rows = (fvRows ?? []) as unknown as Row[];
  if (rows.length < 2) return bad('crosswalk requires at least two frameworks loaded', 400);

  function flatten(r: Row) {
    const fw = Array.isArray(r.frameworks) ? r.frameworks[0] : r.frameworks;
    return fw ? { id: r.id, version: r.version, name: fw.display_name, definition: r.definition } : null;
  }
  const fws = rows.map(flatten).filter((x): x is NonNullable<ReturnType<typeof flatten>> => x !== null);

  // Default source = tenant's active framework via tenant_frameworks;
  // fallback = first framework in the catalog. Default target = first
  // framework that isn't the source.
  const { data: tfRow } = await supabase
    .from('tenant_frameworks')
    .select('framework_version_id')
    .eq('tenant_id', tenant.id)
    .limit(1)
    .maybeSingle();
  const tenantActiveFv = (tfRow as { framework_version_id: string } | null)?.framework_version_id ?? null;
  const sourceId = sourceParam || tenantActiveFv || fws[0].id;
  const targetId = targetParam
    || fws.find((f) => f.id !== sourceId)?.id
    || fws[1].id;

  const source = fws.find((f) => f.id === sourceId);
  const target = fws.find((f) => f.id === targetId);
  if (!source || !target) return bad('invalid framework selection', 400);

  // Compute coverage from source → target.
  const coverage = await computeInheritedCoverage({
    tenantId: tenant.id,
    sourceFrameworkVersionId: sourceId,
    targetFrameworkVersionId: targetId,
    supabase,
  });
  const coverageByTarget = new Map<string, typeof coverage[number]>();
  for (const c of coverage) coverageByTarget.set(c.target_control_id, c);

  // Build source-control outcome lookup so the PDF can show what each
  // contributing source control is actually about (rather than just the
  // bare ID).
  const sourceOutcome = new Map<string, string>();
  for (const g of source.definition.groups) {
    for (const cat of g.categories) {
      for (const ctrl of cat.controls) sourceOutcome.set(ctrl.id, ctrl.outcome);
    }
  }

  // Flatten target into the per-control payload the PDF wants. Walks
  // groups → categories → controls in framework-definition order so the
  // report reads top-to-bottom by theme.
  const targetControls: CrosswalkTargetControl[] = [];
  for (const g of target.definition.groups) {
    for (const cat of g.categories) {
      for (const ctrl of cat.controls) {
        const cov = coverageByTarget.get(ctrl.id);
        targetControls.push({
          control_id: ctrl.id,
          outcome: ctrl.outcome,
          group_id: g.id,
          group_name: g.name,
          category_id: cat.id,
          category_name: cat.name,
          inherited_pra: cov?.inherited_pra ?? null,
          inherited_pol: cov?.inherited_pol ?? null,
          source_count: cov?.source_count ?? 0,
          contributors: (cov?.contributors ?? []).map((s) => ({
            source_control_id: s.source_control_id,
            source_outcome: sourceOutcome.get(s.source_control_id) ?? null,
            relationship: s.relationship,
            pra: s.pra,
            pol: s.pol,
          })),
        });
      }
    }
  }

  const buffer = await renderToBuffer(
    React.createElement(CrosswalkReport, {
      tenant,
      sourceName: source.name, sourceVersion: source.version,
      targetName: target.name, targetVersion: target.version,
      targetControls,
      asOf: new Date(),
    }) as React.ReactElement,
  );

  const filename = `${slugify(tenant.slug)}-${slugify(target.name)}-coverage-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
