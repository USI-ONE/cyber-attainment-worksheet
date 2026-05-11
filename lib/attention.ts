/**
 * Attention feed — server-side aggregation of the things across the platform
 * that need a human's attention right now. Used by:
 *   - Dashboard (/) — full feed for the current tenant.
 *   - Portfolio Hub — per-tenant rollup counts for the operator-side view.
 *
 * Adding a new signal: insert a fetcher into computeAttention() that pushes
 * one or more AttentionItem rows. Keep the SLOs in lib comments aligned —
 * the Hub uses item counts as a health indicator across the portfolio.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '@/lib/supabase/server';

export type AttentionSeverity = 'critical' | 'high' | 'medium' | 'low';

export type AttentionKind =
  | 'high_risk_untreated'
  | 'high_risk_no_treatments'
  | 'risk_review_overdue'
  | 'dr_test_overdue'
  | 'dr_test_failed'
  | 'playbook_review_overdue'
  | 'incident_open_critical'
  | 'priority_overdue'
  | 'task_overdue';

export interface AttentionItem {
  kind: AttentionKind;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  href: string;
  age_days?: number | null;
  refs?: { code?: string; control_id?: string };
}

export interface AttentionSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  by_kind: Partial<Record<AttentionKind, number>>;
}

/** Days between an ISO date string and today. Negative if the date is in the
 *  future. Returns null if the input is null or invalid. */
function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

function fmtAge(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  if (days < 365) return `${Math.floor(days / 30)} months`;
  return `${Math.floor(days / 365)} years`;
}

const TIER_TAG = ['', 'Tier 1', 'Tier 2', 'Tier 3'];

/**
 * Compute the attention feed for one tenant. Runs every fetcher in parallel
 * so a slow signal doesn't block the rest. Order of items matters — we sort
 * by severity weight at the end so consumers can render top-down.
 */
export async function computeAttention(
  tenantId: string,
  supabase?: SupabaseClient,
): Promise<AttentionItem[]> {
  const db = supabase ?? createServiceRoleClient();
  const todayISO = new Date().toISOString().slice(0, 10);

  const [
    risksRes,
    treatmentsRes,
    drRes,
    playbooksRes,
    incidentsRes,
    prioritiesRes,
    tasksRes,
  ] = await Promise.all([
    db.from('risks')
      .select('id, code, title, residual_score, status, next_review_due, treatment_strategy')
      .eq('tenant_id', tenantId),
    db.from('risk_treatments')
      .select('risk_id, status')
      .eq('tenant_id', tenantId),
    db.from('dr_plans')
      .select('id, name, tier, next_test_due, last_test_result, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'active'),
    db.from('ir_playbooks')
      .select('id, name, category, next_review_due, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'active'),
    db.from('incidents')
      .select('id, title, severity, status, detected_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .in('severity', ['high', 'critical']),
    db.from('priorities')
      .select('id, title, priority_level, due_date, status')
      .eq('tenant_id', tenantId)
      .neq('status', 'Complete')
      .not('due_date', 'is', null)
      .lt('due_date', todayISO),
    db.from('work_plan_tasks')
      .select('id, control_id, title, due_date, status')
      .eq('tenant_id', tenantId)
      .neq('status', 'Complete')
      .not('due_date', 'is', null)
      .lt('due_date', todayISO),
  ]);

  const out: AttentionItem[] = [];

  // ---- Risks ------------------------------------------------------------
  const treatmentsByRisk = new Map<string, { inFlight: number; total: number }>();
  for (const t of (treatmentsRes.data ?? []) as { risk_id: string; status: string }[]) {
    const s = treatmentsByRisk.get(t.risk_id) ?? { inFlight: 0, total: 0 };
    s.total++;
    if (t.status === 'In Progress') s.inFlight++;
    treatmentsByRisk.set(t.risk_id, s);
  }

  for (const r of (risksRes.data ?? []) as {
    id: string; code: string; title: string;
    residual_score: number; status: string;
    next_review_due: string | null;
    treatment_strategy: string;
  }[]) {
    const isOpenLike = !['closed', 'accepted', 'transferred'].includes(r.status);
    const stats = treatmentsByRisk.get(r.id) ?? { inFlight: 0, total: 0 };

    // High/Extreme residual risk with no treatments at all.
    if (r.residual_score >= 15 && r.treatment_strategy === 'mitigate' && stats.total === 0 && isOpenLike) {
      out.push({
        kind: 'high_risk_no_treatments',
        severity: r.residual_score >= 20 ? 'critical' : 'high',
        title: `${r.code} — ${r.title}`,
        detail: `${r.residual_score >= 20 ? 'Extreme' : 'High'} residual risk (${r.residual_score}) with no treatment actions on file.`,
        href: '/risks',
        refs: { code: r.code },
      });
    }
    // High/Extreme residual risk with treatments but none in flight.
    else if (r.residual_score >= 15 && r.treatment_strategy === 'mitigate' && stats.total > 0 && stats.inFlight === 0 && isOpenLike) {
      out.push({
        kind: 'high_risk_untreated',
        severity: r.residual_score >= 20 ? 'critical' : 'high',
        title: `${r.code} — ${r.title}`,
        detail: `${r.residual_score >= 20 ? 'Extreme' : 'High'} residual risk (${r.residual_score}) — ${stats.total} treatments logged but none currently in progress.`,
        href: '/risks',
        refs: { code: r.code },
      });
    }

    // Overdue review (only on risks that aren't closed/accepted/transferred).
    if (isOpenLike) {
      const days = daysSince(r.next_review_due);
      if (days != null && days > 0) {
        out.push({
          kind: 'risk_review_overdue',
          severity: days > 90 ? 'medium' : 'low',
          title: `${r.code} — review overdue`,
          detail: `Risk review was due ${fmtAge(days)} ago. Status: ${r.status}.`,
          href: '/risks',
          age_days: days,
          refs: { code: r.code },
        });
      }
    }
  }

  // ---- DR plans ---------------------------------------------------------
  for (const d of (drRes.data ?? []) as {
    id: string; name: string; tier: number;
    next_test_due: string | null; last_test_result: string | null; status: string;
  }[]) {
    const days = daysSince(d.next_test_due);
    if (days != null && days > 0) {
      const sev: AttentionSeverity = d.tier === 1 ? 'high' : d.tier === 2 ? 'medium' : 'low';
      out.push({
        kind: 'dr_test_overdue',
        severity: sev,
        title: `${d.name} — DR test overdue`,
        detail: `${TIER_TAG[d.tier] ?? 'DR plan'} restoration test was due ${fmtAge(days)} ago.`,
        href: '/dr-plans',
        age_days: days,
      });
    }
    if (d.last_test_result === 'fail') {
      out.push({
        kind: 'dr_test_failed',
        severity: d.tier === 1 ? 'critical' : 'high',
        title: `${d.name} — last DR test failed`,
        detail: `${TIER_TAG[d.tier] ?? 'DR plan'}: last recorded test result is "fail". Re-run after remediation.`,
        href: '/dr-plans',
      });
    }
  }

  // ---- IR playbooks ----------------------------------------------------
  for (const p of (playbooksRes.data ?? []) as {
    id: string; name: string; category: string;
    next_review_due: string | null;
  }[]) {
    const days = daysSince(p.next_review_due);
    if (days != null && days > 0) {
      out.push({
        kind: 'playbook_review_overdue',
        severity: days > 180 ? 'medium' : 'low',
        title: `${p.name} — playbook review overdue`,
        detail: `${p.category.toUpperCase()} playbook review was due ${fmtAge(days)} ago. Stale playbooks miss new attacker TTPs.`,
        href: '/ir-plans',
        age_days: days,
      });
    }
  }

  // ---- Open critical / high incidents ----------------------------------
  for (const i of (incidentsRes.data ?? []) as {
    id: string; title: string; severity: string; detected_at: string | null;
  }[]) {
    const days = daysSince(i.detected_at) ?? 0;
    out.push({
      kind: 'incident_open_critical',
      severity: i.severity === 'critical' ? 'critical' : 'high',
      title: `Open ${i.severity} incident: ${i.title}`,
      detail: i.detected_at
        ? `Detected ${fmtAge(days)} ago and still open.`
        : `Status is open; detection date not recorded.`,
      href: `/incidents/${i.id}`,
      age_days: days,
    });
  }

  // ---- Overdue priorities ----------------------------------------------
  for (const p of (prioritiesRes.data ?? []) as {
    id: string; title: string; priority_level: number | null;
    due_date: string | null; status: string;
  }[]) {
    const days = daysSince(p.due_date);
    if (days == null || days <= 0) continue;
    const lvl = p.priority_level ?? 0;
    const sev: AttentionSeverity =
      lvl >= 4 ? 'high'
      : lvl >= 3 ? 'medium'
      : 'low';
    out.push({
      kind: 'priority_overdue',
      severity: sev,
      title: `Priority overdue: ${p.title}`,
      detail: `Due ${fmtAge(days)} ago · status ${p.status}${lvl ? ` · level ${lvl}` : ''}.`,
      href: '/priorities',
      age_days: days,
    });
  }

  // ---- Overdue work plan tasks -----------------------------------------
  for (const t of (tasksRes.data ?? []) as {
    id: string; control_id: string; title: string; due_date: string | null; status: string;
  }[]) {
    const days = daysSince(t.due_date);
    if (days == null || days <= 0) continue;
    out.push({
      kind: 'task_overdue',
      severity: days > 60 ? 'medium' : 'low',
      title: `Task overdue: ${t.title}`,
      detail: `Control ${t.control_id} · due ${fmtAge(days)} ago · status ${t.status}.`,
      href: '/work-plans',
      age_days: days,
      refs: { control_id: t.control_id },
    });
  }

  // Sort by severity (worst first), then by age descending. Critical incidents
  // and high risks rise to the top; ancient overdue tasks then bubble up
  // within their severity band.
  const weight: Record<AttentionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  out.sort((a, b) => {
    const w = weight[a.severity] - weight[b.severity];
    if (w !== 0) return w;
    return (b.age_days ?? 0) - (a.age_days ?? 0);
  });

  return out;
}

/** Cheap rollup for the Portfolio Hub — counts by severity and kind without
 *  carrying full item bodies through render. */
export function summarize(items: AttentionItem[]): AttentionSummary {
  const out: AttentionSummary = {
    total: items.length,
    critical: 0, high: 0, medium: 0, low: 0,
    by_kind: {},
  };
  for (const it of items) {
    out[it.severity]++;
    out.by_kind[it.kind] = (out.by_kind[it.kind] ?? 0) + 1;
  }
  return out;
}
