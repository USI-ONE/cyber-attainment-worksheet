import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, registerFonts } from './styles';
import { GROUP_COLORS, type GroupAverage, type OverallTotals } from '@/lib/scoring';
import type { Tenant } from '@/lib/supabase/types';

/**
 * Executive Posture Briefing — board-ready summary of the tenant's NIST
 * CSF 2.0 attainment scoring. Includes per-function table, overall
 * gap-to-goal, top weakest controls, and recent activity context.
 */

registerFonts();

interface ControlGap {
  control_id: string;
  pol: number | null;
  pra: number | null;
  gol: number | null;
}

export function DashboardReport({
  tenant,
  groupAverages,
  totals,
  topGaps,
  asOf,
  incidentSummary,
  policyDocCount,
}: {
  tenant: Tenant;
  groupAverages: GroupAverage[];
  totals: OverallTotals;
  topGaps: ControlGap[];
  asOf: Date;
  incidentSummary: { open: number; total: number };
  policyDocCount: number;
}) {
  const palette = paletteFor(tenant);
  const fmt2 = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(2));

  return (
    <Document
      title={`${tenant.display_name} — Executive Posture Briefing`}
      author={tenant.display_name}
      subject="NIST CSF 2.0 Attainment — Executive Briefing"
      creator="Cyber Attainment Worksheet"
    >
      <Page size="LETTER" style={baseStyles.page}>
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · Executive Posture Briefing</Text>
        </View>
        <View style={baseStyles.pageFooter} fixed>
          <Text>As of {fmtDate(asOf.toISOString())}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        {/* Cover */}
        <View style={[baseStyles.cover, { borderBottomColor: palette.primary }]}>
          <Text style={[baseStyles.coverEyebrow, { color: palette.primary }]}>
            Executive Posture Briefing
          </Text>
          <Text style={baseStyles.coverTitle}>NIST CSF 2.0 Attainment Summary</Text>
          <Text style={[baseStyles.coverSub, { marginTop: 6 }]}>
            Prepared for: Chief Executive Officer · Chief Financial Officer · Board Members
          </Text>

          <View style={[baseStyles.metaGrid, { marginTop: 18 }]}>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Overall Policy Avg</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {fmt2(totals.pol_avg)}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Overall Practice Avg</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {fmt2(totals.pra_avg)}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Overall Goal Avg</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {fmt2(totals.gol_avg)}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Gap to Goal</Text>
              <Text style={[baseStyles.metaVal, {
                fontSize: 18, fontWeight: 700,
                color: (totals.gap ?? 0) > 0 ? palette.severity.high : palette.status.closed,
              }]}>
                {totals.gap == null ? '—' : (totals.gap > 0 ? '+' : '') + Number(totals.gap).toFixed(2)}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Open Incidents</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 14, fontWeight: 600 }]}>
                {incidentSummary.open} of {incidentSummary.total}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Active Policy Documents</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 14, fontWeight: 600 }]}>
                {policyDocCount}
              </Text>
            </View>
          </View>
        </View>

        {/* Function-level table */}
        <Text style={baseStyles.sectionH}>1. NIST CSF 2.0 Function Scoring</Text>
        <Text style={[baseStyles.para, { fontSize: 9, color: palette.muted }]}>
          Three-column scoring per function on the 1–5 CMM maturity scale:
          Policy (what we&apos;ve written), Practice (what we actually do),
          Goal (where we want to be). The Gap column highlights where
          remediation effort should concentrate.
        </Text>
        <View style={baseStyles.table}>
          <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
            <Text style={[baseStyles.th, { width: '45%' }]}>Function</Text>
            <Text style={[baseStyles.th, { width: '11%', textAlign: 'right' }]}>Policy</Text>
            <Text style={[baseStyles.th, { width: '11%', textAlign: 'right' }]}>Practice</Text>
            <Text style={[baseStyles.th, { width: '11%', textAlign: 'right' }]}>Goal</Text>
            <Text style={[baseStyles.th, { width: '11%', textAlign: 'right' }]}>Gap</Text>
            <Text style={[baseStyles.th, { width: '11%', textAlign: 'right' }]}>Scored</Text>
          </View>
          {groupAverages.map((a) => {
            const c = GROUP_COLORS[a.group_id] ?? { accent: palette.primary, text: palette.ink, bg: '' };
            const gap = a.pra && a.gol ? a.gol - a.pra : null;
            return (
              <View key={a.group_id} style={baseStyles.tr} wrap={false}>
                <View style={{ width: '45%', flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{
                    width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent, marginRight: 8,
                  }} />
                  <Text style={[baseStyles.td, { fontWeight: 600, color: c.accent, width: 28 }]}>{a.group_id}</Text>
                  <Text style={baseStyles.td}>{a.group_name}</Text>
                </View>
                <Text style={[baseStyles.tdNum, { width: '11%' }]}>{fmt2(a.pol || null)}</Text>
                <Text style={[baseStyles.tdNum, { width: '11%' }]}>{fmt2(a.pra || null)}</Text>
                <Text style={[baseStyles.tdNum, { width: '11%' }]}>{fmt2(a.gol || null)}</Text>
                <Text style={[baseStyles.tdNum, {
                  width: '11%', color: gap == null ? palette.muted : gap > 0 ? palette.severity.high : palette.status.closed,
                }]}>
                  {gap == null ? '—' : (gap > 0 ? '+' : '') + gap.toFixed(2)}
                </Text>
                <Text style={[baseStyles.tdNum, { width: '11%' }]}>{a.pra_n}/{a.total}</Text>
              </View>
            );
          })}
          <View style={[baseStyles.tr, { borderTopWidth: 1, borderTopColor: palette.ink, borderBottomWidth: 0, paddingTop: 8 }]}>
            <Text style={[baseStyles.td, { width: '45%', fontWeight: 700 }]}>Overall</Text>
            <Text style={[baseStyles.tdNum, { width: '11%', fontWeight: 700 }]}>{fmt2(totals.pol_avg)}</Text>
            <Text style={[baseStyles.tdNum, { width: '11%', fontWeight: 700 }]}>{fmt2(totals.pra_avg)}</Text>
            <Text style={[baseStyles.tdNum, { width: '11%', fontWeight: 700 }]}>{fmt2(totals.gol_avg)}</Text>
            <Text style={[baseStyles.tdNum, {
              width: '11%', fontWeight: 700,
              color: totals.gap == null ? palette.muted : totals.gap > 0 ? palette.severity.high : palette.status.closed,
            }]}>
              {totals.gap == null ? '—' : (totals.gap > 0 ? '+' : '') + totals.gap.toFixed(2)}
            </Text>
            <Text style={[baseStyles.tdNum, { width: '11%', fontWeight: 700 }]}>{totals.scored_pra}/{totals.total}</Text>
          </View>
        </View>

        {/* Top gaps — controls farthest from goal */}
        {topGaps.length > 0 && (
          <View>
            <Text style={baseStyles.sectionH}>2. Top Remediation Targets</Text>
            <Text style={[baseStyles.para, { fontSize: 9, color: palette.muted }]}>
              The {topGaps.length} controls with the largest gap between current Practice
              and Goal. These are the highest-leverage places to invest the next quarter.
            </Text>
            <View style={baseStyles.table}>
              <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
                <Text style={[baseStyles.th, { width: '20%' }]}>Control</Text>
                <Text style={[baseStyles.th, { width: '20%', textAlign: 'right' }]}>Policy</Text>
                <Text style={[baseStyles.th, { width: '20%', textAlign: 'right' }]}>Practice</Text>
                <Text style={[baseStyles.th, { width: '20%', textAlign: 'right' }]}>Goal</Text>
                <Text style={[baseStyles.th, { width: '20%', textAlign: 'right' }]}>Gap</Text>
              </View>
              {topGaps.map((g) => {
                const gap = (g.pra ?? 0) && (g.gol ?? 0) ? (g.gol! - g.pra!) : null;
                return (
                  <View key={g.control_id} style={baseStyles.tr} wrap={false}>
                    <Text style={[baseStyles.td, { width: '20%', fontWeight: 600 }]}>{g.control_id}</Text>
                    <Text style={[baseStyles.tdNum, { width: '20%' }]}>{fmt2(g.pol)}</Text>
                    <Text style={[baseStyles.tdNum, { width: '20%' }]}>{fmt2(g.pra)}</Text>
                    <Text style={[baseStyles.tdNum, { width: '20%' }]}>{fmt2(g.gol)}</Text>
                    <Text style={[baseStyles.tdNum, {
                      width: '20%',
                      color: gap == null ? palette.muted : gap > 0 ? palette.severity.high : palette.status.closed,
                    }]}>
                      {gap == null ? '—' : (gap > 0 ? '+' : '') + gap.toFixed(2)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Footer narrative */}
        <View style={{ marginTop: 18 }}>
          <Text style={baseStyles.sectionH}>3. Reading This Report</Text>
          <Text style={baseStyles.para}>
            <Text style={{ fontWeight: 600 }}>Policy</Text> reflects what is written down
            and approved. <Text style={{ fontWeight: 600 }}>Practice</Text> reflects what
            actually happens day-to-day. <Text style={{ fontWeight: 600 }}>Goal</Text> is
            the maturity tier this organization is working toward. The CMM scale: 1
            Initial · 2 Repeatable · 3 Defined · 4 Managed · 5 Optimizing.
          </Text>
          <Text style={baseStyles.para}>
            A {`>0`} gap means Practice is below Goal — work to do. A negative gap
            means Practice already meets or exceeds Goal — those controls are
            performing as intended.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
