import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, registerFonts } from './styles';
import type { Tenant } from '@/lib/supabase/types';

/**
 * Disaster Recovery Plans — auditor-ready PDF of every active DR plan.
 *
 * Why this exists: when ransomware hits or a primary system fails, the
 * incident commander wants a printed binder, not a portal. This is that
 * binder. One page (or contiguous pages) per plan with every field an
 * operator needs to execute the recovery — tier, RTO/RPO, backup story,
 * step-by-step procedure, owner + team, dependencies, last-test record,
 * NIST CSF crosswalk.
 *
 * Cover summarizes the portfolio:
 *   - Total plans by tier
 *   - Tested vs untested count
 *   - Overdue test count (next_test_due in the past) with red callout
 *   - Failed-test count (last_test_result = 'fail') with red callout
 */

registerFonts();

export interface DrPlanRow {
  id: string;
  name: string;
  system_name: string | null;
  tier: number; // 1 | 2 | 3
  rto_minutes: number | null;
  rpo_minutes: number | null;
  description: string | null;
  backup_method: string | null;
  backup_frequency: string | null;
  backup_retention: string | null;
  recovery_steps: string[];
  recovery_owner: string | null;
  recovery_team: string[];
  dependencies: string[];
  last_tested: string | null;
  last_test_result: string | null;
  last_test_notes: string | null;
  next_test_due: string | null;
  linked_control_ids: string[];
  status: string;
}

const TIER_LABEL: Record<number, string> = {
  1: 'Tier 1 — Critical',
  2: 'Tier 2 — Important',
  3: 'Tier 3 — Standard',
};

const TIER_TAG: Record<number, string> = {
  1: 'mission-critical · RTO ≤ 4h',
  2: 'business-important · RTO ≤ 24h',
  3: 'standard · RTO ≤ 72h',
};

function fmtMinutes(m: number | null): string {
  if (m == null) return '—';
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60 * 10) / 10}h`;
  return `${Math.round(m / 60 / 24 * 10) / 10}d`;
}

function tierColor(tier: number, palette: ReturnType<typeof paletteFor>): string {
  if (tier === 1) return palette.severity.high;
  if (tier === 2) return palette.severity.medium;
  return palette.muted;
}

function resultColor(result: string | null, palette: ReturnType<typeof paletteFor>): string {
  if (result === 'pass')    return palette.status.closed;
  if (result === 'partial') return palette.severity.medium;
  if (result === 'fail')    return palette.severity.high;
  return palette.muted;
}

export function DrPlansReport({
  tenant, plans, asOf,
}: {
  tenant: Tenant;
  plans: DrPlanRow[];
  asOf: Date;
}) {
  const palette = paletteFor(tenant);
  const todayMs = asOf.getTime();

  const active = plans.filter((p) => p.status === 'active');
  const total = active.length;
  const tested = active.filter((p) => p.last_tested).length;
  const overdue = active.filter((p) => p.next_test_due && new Date(p.next_test_due).getTime() < todayMs).length;
  const failed = active.filter((p) => p.last_test_result === 'fail').length;
  const tierCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const p of active) tierCounts[p.tier]++;

  // Sort by tier then name so tier-1 critical plans lead the document.
  const sorted = [...active].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

  return (
    <Document
      title={`${tenant.display_name} — Disaster Recovery Plans`}
      author={tenant.display_name}
      subject="DR Plan Binder"
      creator="TrustOS"
    >
      {/* ====================== Cover ====================== */}
      <Page size="LETTER" style={baseStyles.page}>
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · DR Plan Binder</Text>
        </View>
        <View style={baseStyles.pageFooter} fixed>
          <Text>As of {fmtDate(asOf.toISOString())}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        <View style={[baseStyles.cover, { borderBottomColor: palette.primary }]}>
          <Text style={[baseStyles.coverEyebrow, { color: palette.primary }]}>
            Disaster Recovery Plans
          </Text>
          <Text style={baseStyles.coverTitle}>
            Recovery procedures · RTO / RPO commitments · Test cadence
          </Text>
          <Text style={[baseStyles.coverSub, { marginTop: 6 }]}>
            Prepared for: Incident Commander · CIO · External Auditor
          </Text>

          <View style={[baseStyles.metaGrid, { marginTop: 18 }]}>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Active Plans</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {total}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                T1 {tierCounts[1]} · T2 {tierCounts[2]} · T3 {tierCounts[3]}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Tested</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {tested} / {total}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Overdue Test</Text>
              <Text style={[baseStyles.metaVal, {
                fontSize: 18, fontWeight: 700,
                color: overdue > 0 ? palette.severity.high : palette.status.closed,
              }]}>
                {overdue}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                {overdue > 0 ? 'past next-test date' : 'all on schedule'}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Failed Last Test</Text>
              <Text style={[baseStyles.metaVal, {
                fontSize: 18, fontWeight: 700,
                color: failed > 0 ? palette.severity.high : palette.status.closed,
              }]}>
                {failed}
              </Text>
            </View>
          </View>
        </View>

        {/* Per-tier summary table */}
        <Text style={baseStyles.sectionH}>Plans Index</Text>
        <View style={baseStyles.table}>
          <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
            <Text style={[baseStyles.th, { width: '8%' }]}>Tier</Text>
            <Text style={[baseStyles.th, { width: '44%' }]}>Name / System</Text>
            <Text style={[baseStyles.th, { width: '10%', textAlign: 'right' }]}>RTO</Text>
            <Text style={[baseStyles.th, { width: '10%', textAlign: 'right' }]}>RPO</Text>
            <Text style={[baseStyles.th, { width: '14%' }]}>Last test</Text>
            <Text style={[baseStyles.th, { width: '14%' }]}>Next due</Text>
          </View>
          {sorted.map((p) => {
            const od = p.next_test_due && new Date(p.next_test_due).getTime() < todayMs;
            return (
              <View key={p.id} style={baseStyles.tr} wrap={false}>
                <Text style={[baseStyles.td, { width: '8%', color: tierColor(p.tier, palette), fontWeight: 700 }]}>
                  T{p.tier}
                </Text>
                <View style={{ width: '44%' }}>
                  <Text style={[baseStyles.td, { fontWeight: 700 }]}>{p.name}</Text>
                  {p.system_name && (
                    <Text style={{ fontSize: 8, color: palette.muted }}>{p.system_name}</Text>
                  )}
                </View>
                <Text style={[baseStyles.tdMono, { width: '10%', textAlign: 'right' }]}>
                  {fmtMinutes(p.rto_minutes)}
                </Text>
                <Text style={[baseStyles.tdMono, { width: '10%', textAlign: 'right' }]}>
                  {fmtMinutes(p.rpo_minutes)}
                </Text>
                <View style={{ width: '14%' }}>
                  <Text style={baseStyles.tdMono}>{p.last_tested ?? '—'}</Text>
                  {p.last_test_result && (
                    <Text style={{ fontSize: 8, color: resultColor(p.last_test_result, palette), fontWeight: 700, textTransform: 'capitalize' }}>
                      {p.last_test_result}
                    </Text>
                  )}
                </View>
                <Text style={[baseStyles.tdMono, {
                  width: '14%',
                  color: od ? palette.severity.high : palette.body,
                  fontWeight: od ? 700 : 400,
                }]}>
                  {p.next_test_due ?? '—'}{od ? ' (overdue)' : ''}
                </Text>
              </View>
            );
          })}
        </View>

        <Text style={[baseStyles.para, { fontSize: 9, color: palette.muted, marginTop: 18 }]}>
          Each plan that follows lists the full recovery procedure: system
          identity, recovery time / point objectives, backup story, ordered
          recovery steps, owner + team, upstream dependencies, last-test
          record, and the NIST CSF controls the plan satisfies.
        </Text>
      </Page>

      {/* ====================== One section per plan ====================== */}
      {sorted.map((p) => {
        const tColor = tierColor(p.tier, palette);
        return (
          <Page key={p.id} size="LETTER" style={baseStyles.page}>
            <View style={baseStyles.pageHeader} fixed>
              <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
              <Text style={baseStyles.pageHeaderType}>Confidential · DR · T{p.tier}</Text>
            </View>
            <View style={baseStyles.pageFooter} fixed>
              <Text>As of {fmtDate(asOf.toISOString())}</Text>
              <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
            </View>

            <View style={{ marginBottom: 14, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: tColor }}>
              <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9, color: tColor, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                {TIER_LABEL[p.tier]} · {TIER_TAG[p.tier]}
              </Text>
              <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 18, color: palette.ink, marginTop: 4 }}>
                {p.name}
              </Text>
              {p.system_name && (
                <Text style={{ fontSize: 10, color: palette.body, marginTop: 2 }}>
                  System: {p.system_name}
                </Text>
              )}
            </View>

            {/* Top stats grid */}
            <View style={[baseStyles.metaGrid, { marginBottom: 12, marginTop: 0 }]}>
              <View style={[baseStyles.metaItem, { width: '25%' }]}>
                <Text style={baseStyles.metaLabel}>RTO</Text>
                <Text style={[baseStyles.metaVal, { fontSize: 14, fontWeight: 700, color: tColor }]}>
                  {fmtMinutes(p.rto_minutes)}
                </Text>
              </View>
              <View style={[baseStyles.metaItem, { width: '25%' }]}>
                <Text style={baseStyles.metaLabel}>RPO</Text>
                <Text style={[baseStyles.metaVal, { fontSize: 14, fontWeight: 700, color: tColor }]}>
                  {fmtMinutes(p.rpo_minutes)}
                </Text>
              </View>
              <View style={[baseStyles.metaItem, { width: '25%' }]}>
                <Text style={baseStyles.metaLabel}>Owner</Text>
                <Text style={baseStyles.metaVal}>{p.recovery_owner ?? '—'}</Text>
              </View>
              <View style={[baseStyles.metaItem, { width: '25%' }]}>
                <Text style={baseStyles.metaLabel}>Next Test Due</Text>
                <Text style={[baseStyles.metaVal, {
                  color: p.next_test_due && new Date(p.next_test_due).getTime() < todayMs
                    ? palette.severity.high : palette.body,
                  fontWeight: 700,
                }]}>
                  {p.next_test_due ?? '—'}
                </Text>
              </View>
            </View>

            {p.description && (
              <View style={{ marginBottom: 12 }}>
                <Text style={[baseStyles.metaLabel, { marginBottom: 4 }]}>Description</Text>
                <Text style={[baseStyles.para, { fontSize: 10, color: palette.body }]}>
                  {p.description}
                </Text>
              </View>
            )}

            {/* Backup story */}
            {(p.backup_method || p.backup_frequency || p.backup_retention) && (
              <View style={{ marginBottom: 12 }}>
                <Text style={baseStyles.sectionH}>Backup Story</Text>
                <View style={baseStyles.table}>
                  {p.backup_method && (
                    <View style={baseStyles.tr} wrap={false}>
                      <Text style={[baseStyles.th, { width: '20%' }]}>Method</Text>
                      <Text style={[baseStyles.td, { width: '80%' }]}>{p.backup_method}</Text>
                    </View>
                  )}
                  {p.backup_frequency && (
                    <View style={baseStyles.tr} wrap={false}>
                      <Text style={[baseStyles.th, { width: '20%' }]}>Frequency</Text>
                      <Text style={[baseStyles.td, { width: '80%' }]}>{p.backup_frequency}</Text>
                    </View>
                  )}
                  {p.backup_retention && (
                    <View style={baseStyles.tr} wrap={false}>
                      <Text style={[baseStyles.th, { width: '20%' }]}>Retention</Text>
                      <Text style={[baseStyles.td, { width: '80%' }]}>{p.backup_retention}</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Recovery steps */}
            {p.recovery_steps.length > 0 && (
              <View style={{ marginBottom: 12 }}>
                <Text style={baseStyles.sectionH}>Recovery Steps</Text>
                {p.recovery_steps.map((s, i) => (
                  <View key={i} style={{ flexDirection: 'row', marginBottom: 4 }} wrap={false}>
                    <Text style={{ width: 24, fontSize: 10, color: tColor, fontWeight: 700 }}>{i + 1}.</Text>
                    <Text style={{ flex: 1, fontSize: 10, color: palette.body, lineHeight: 1.5 }}>{s}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Team + dependencies side by side */}
            {(p.recovery_team.length > 0 || p.dependencies.length > 0) && (
              <View style={{ flexDirection: 'row', gap: 16, marginBottom: 12 }}>
                {p.recovery_team.length > 0 && (
                  <View style={{ flex: 1 }}>
                    <Text style={[baseStyles.metaLabel, { marginBottom: 4 }]}>Recovery Team</Text>
                    {p.recovery_team.map((m, i) => (
                      <Text key={i} style={{ fontSize: 9, color: palette.body, marginBottom: 2 }}>• {m}</Text>
                    ))}
                  </View>
                )}
                {p.dependencies.length > 0 && (
                  <View style={{ flex: 1 }}>
                    <Text style={[baseStyles.metaLabel, { marginBottom: 4 }]}>Dependencies</Text>
                    {p.dependencies.map((d, i) => (
                      <Text key={i} style={{ fontSize: 9, color: palette.body, marginBottom: 2 }}>• {d}</Text>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Last test record */}
            {(p.last_tested || p.last_test_result || p.last_test_notes) && (
              <View style={{ marginBottom: 12 }}>
                <Text style={baseStyles.sectionH}>Last Test Record</Text>
                <View style={[baseStyles.metaGrid, { marginTop: 0 }]}>
                  <View style={[baseStyles.metaItem, { width: '33%' }]}>
                    <Text style={baseStyles.metaLabel}>Date</Text>
                    <Text style={baseStyles.metaVal}>{p.last_tested ?? '—'}</Text>
                  </View>
                  <View style={[baseStyles.metaItem, { width: '33%' }]}>
                    <Text style={baseStyles.metaLabel}>Result</Text>
                    <Text style={[baseStyles.metaVal, {
                      color: resultColor(p.last_test_result, palette),
                      fontWeight: 700, textTransform: 'capitalize',
                    }]}>
                      {p.last_test_result ?? '—'}
                    </Text>
                  </View>
                </View>
                {p.last_test_notes && (
                  <Text style={[baseStyles.para, { fontSize: 9, color: palette.body, marginTop: 4 }]}>
                    {p.last_test_notes}
                  </Text>
                )}
              </View>
            )}

            {/* Linked controls footer */}
            {p.linked_control_ids.length > 0 && (
              <View style={{
                marginTop: 12, paddingTop: 8,
                borderTopWidth: 0.5, borderTopColor: palette.rule,
              }}>
                <Text style={{ fontSize: 8, color: palette.muted }}>
                  NIST CSF controls satisfied: {p.linked_control_ids.join(', ')}
                </Text>
              </View>
            )}
          </Page>
        );
      })}
    </Document>
  );
}
