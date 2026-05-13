import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import {
  AuditBinderReport,
  type BinderControlData,
  type BinderRisk,
  type BinderPolicyDoc,
  type BinderEvidence,
  type BinderDrPlan,
  type BinderIrPlaybook,
} from '@/lib/pdf/AuditBinderReport';

/**
 * GET /api/report/audit-binder — assemble the audit-ready binder PDF.
 *
 * Walks every control in the active framework, indexes all
 * cross-referenced data (current_scores, assessment_responses, risks,
 * policy_documents, evidence_artifacts, dr_plans, ir_playbooks,
 * incidents) by control_id, and hands the assembled payload to
 * lib/pdf/AuditBinderReport for rendering.
 *
 * Why a single endpoint instead of pulling each table separately on the
 * client and PDF-ing on-demand: the binder must be deterministic at a
 * point in time, large enough that round-trips matter, and is generated
 * rarely enough that the server-render cost is irrelevant. Single
 * server hop with the service-role client keeps it simple.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120; // 106 controls × N linked items per — give it room.

function bad(msg: string, code = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status: code, headers: { 'Content-Type': 'application/json' },
  });
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 80) || 'tenant';
}

/** Index helper: for every row that has linked_control_ids text[], push the
 *  row into a per-control bucket so each control's data is O(1) to fetch. */
function indexByControlIds<T extends { linked_control_ids: string[] }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const row of rows) {
    for (const cid of row.linked_control_ids ?? []) {
      const arr = m.get(cid) ?? [];
      arr.push(row);
      m.set(cid, arr);
    }
  }
  return m;
}

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const fw = await loadActiveFramework(tenant);
  if (!fw) return bad('no active framework');

  const supabase = createServiceRoleClient();

  // Parallel-fetch everything the binder needs. Each query is tenant-scoped.
  const [
    scoresRes, responsesRes, risksRes, policyDocsRes,
    evidenceRes, drPlansRes, irPlaybooksRes, incidentsRes,
  ] = await Promise.all([
    supabase.from('current_scores')
      .select('control_id, pol, pra, gol, owner, status, notes')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id),
    supabase.from('assessment_responses')
      .select('control_id, q1_documented, q2_followed, q3_measured, q4_improvement, computed_score')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id),
    supabase.from('risks')
      .select('code, title, residual_score, status, linked_control_ids')
      .eq('tenant_id', tenant.id),
    supabase.from('policy_documents')
      .select('title, version, status, effective_date, linked_control_ids')
      .eq('tenant_id', tenant.id)
      .neq('status', 'archived'),
    supabase.from('evidence_artifacts')
      .select('title, category, filename, collected_date, retention_until, status, linked_control_ids')
      .eq('tenant_id', tenant.id)
      .neq('status', 'archived'),
    supabase.from('dr_plans')
      .select('name, tier, last_tested, last_test_result, linked_control_ids')
      .eq('tenant_id', tenant.id)
      .eq('status', 'active'),
    supabase.from('ir_playbooks')
      .select('name, category, last_reviewed, linked_control_ids')
      .eq('tenant_id', tenant.id)
      .eq('status', 'active'),
    supabase.from('incidents')
      .select('id, linked_control_ids')
      .eq('tenant_id', tenant.id),
  ]);

  // Index everything per control id.
  type ScoreRow = { control_id: string; pol: number | null; pra: number | null; gol: number | null; owner: string | null; status: string | null; notes: string | null };
  const scoresByControl = new Map<string, ScoreRow>();
  for (const r of (scoresRes.data ?? []) as ScoreRow[]) scoresByControl.set(r.control_id, r);

  type RespRow = { control_id: string; q1_documented: string | null; q2_followed: string | null; q3_measured: string | null; q4_improvement: string | null; computed_score: number | null };
  const responsesByControl = new Map<string, RespRow>();
  for (const r of (responsesRes.data ?? []) as RespRow[]) responsesByControl.set(r.control_id, r);

  type RiskRow = { code: string; title: string; residual_score: number; status: string; linked_control_ids: string[] };
  const risksByControl = indexByControlIds<RiskRow>((risksRes.data ?? []) as RiskRow[]);

  type PolicyRow = { title: string; version: string | null; status: string; effective_date: string | null; linked_control_ids: string[] };
  const policiesByControl = indexByControlIds<PolicyRow>((policyDocsRes.data ?? []) as PolicyRow[]);

  type EvidenceRow = { title: string; category: string; filename: string | null; collected_date: string | null; retention_until: string | null; status: string; linked_control_ids: string[] };
  const evidenceByControl = indexByControlIds<EvidenceRow>((evidenceRes.data ?? []) as EvidenceRow[]);

  type DrRow = { name: string; tier: number; last_tested: string | null; last_test_result: string | null; linked_control_ids: string[] };
  const drByControl = indexByControlIds<DrRow>((drPlansRes.data ?? []) as DrRow[]);

  type IrRow = { name: string; category: string; last_reviewed: string | null; linked_control_ids: string[] };
  const irByControl = indexByControlIds<IrRow>((irPlaybooksRes.data ?? []) as IrRow[]);

  // Incidents: count per control_id (a list is overkill for the report).
  const incidentCountByControl = new Map<string, number>();
  for (const inc of (incidentsRes.data ?? []) as { linked_control_ids: string[] }[]) {
    for (const cid of inc.linked_control_ids ?? []) {
      incidentCountByControl.set(cid, (incidentCountByControl.get(cid) ?? 0) + 1);
    }
  }

  // Flatten the framework definition into a per-control payload list. Walks
  // group → category → control so order matches the framework definition
  // (GV → ID → PR → DE → RS → RC).
  const controls: BinderControlData[] = [];
  for (const g of fw.definition.groups) {
    for (const cat of g.categories) {
      for (const ctrl of cat.controls) {
        const s = scoresByControl.get(ctrl.id);
        const r = responsesByControl.get(ctrl.id);
        controls.push({
          control_id: ctrl.id,
          outcome: ctrl.outcome,
          group_id: g.id,
          group_name: g.name,
          category_id: cat.id,
          category_name: cat.name,
          score: s ? {
            pol: s.pol, pra: s.pra, gol: s.gol,
            owner: s.owner, status: s.status, notes: s.notes,
          } : null,
          assessment: r ? {
            q1_documented: r.q1_documented, q2_followed: r.q2_followed,
            q3_measured: r.q3_measured, q4_improvement: r.q4_improvement,
            computed_score: r.computed_score,
          } : null,
          risks: (risksByControl.get(ctrl.id) ?? []).map<BinderRisk>((x) => ({
            code: x.code, title: x.title, residual_score: x.residual_score, status: x.status,
          })),
          policies: (policiesByControl.get(ctrl.id) ?? []).map<BinderPolicyDoc>((x) => ({
            title: x.title, version: x.version, status: x.status, effective_date: x.effective_date,
          })),
          evidence: (evidenceByControl.get(ctrl.id) ?? []).map<BinderEvidence>((x) => ({
            title: x.title, category: x.category, filename: x.filename,
            collected_date: x.collected_date, retention_until: x.retention_until, status: x.status,
          })),
          dr_plans: (drByControl.get(ctrl.id) ?? []).map<BinderDrPlan>((x) => ({
            name: x.name, tier: x.tier, last_tested: x.last_tested, last_test_result: x.last_test_result,
          })),
          ir_playbooks: (irByControl.get(ctrl.id) ?? []).map<BinderIrPlaybook>((x) => ({
            name: x.name, category: x.category, last_reviewed: x.last_reviewed,
          })),
          incident_count: incidentCountByControl.get(ctrl.id) ?? 0,
        });
      }
    }
  }

  const buffer = await renderToBuffer(
    React.createElement(AuditBinderReport, {
      tenant,
      definition: fw.definition,
      controls,
      asOf: new Date(),
    }) as React.ReactElement,
  );

  const filename = `${slugify(tenant.slug)}-audit-binder-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
