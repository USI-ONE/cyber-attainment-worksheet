import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, registerFonts } from './styles';
import { GROUP_COLORS } from '@/lib/scoring';
import type { Tenant } from '@/lib/supabase/types';

/**
 * Executive Trend Briefing — per-function Practice maturity over time.
 * Each row is a function (GV/ID/PR/DE/RS/RC + Overall); each column is a
 * snapshot in chronological order. Cells are the mean Practice score for
 * that function at that snapshot. The right-most column shows direction
 * (▲/▼) so the board can see momentum at a glance.
 */

registerFonts();

export interface TrendSnapshot {
  id: string;
  label: string;
  period: string | null;
  taken_at: string;
  by_group: Record<string, number | null>; // group_id -> avg practice
  overall: number | null;
}

export function TrendReport({
  tenant,
  snapshots,
  groups,
  asOf,
}: {
  tenant: Tenant;
  snapshots: TrendSnapshot[];
  groups: { id: string; name: string }[];
  asOf: Date;
}) {
  const palette = paletteFor(tenant);
  const fmt2 = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(2));

  // We render at most ~8 snapshot columns per page comfortably; if the org
  // has more, the table will paginate horizontally via @react-pdf's wrap.
  // For v1 we just show the most recent 8 — board reports rarely need more.
  const cols = snapshots.slice(-8);

  // Direction arrow: latest vs second-latest, per row.
  const direction = (a: number | null, b: number | null) => {
    if (a == null || b == null) return { sym: '—', color: palette.muted };
    const d = a - b;
    if (Math.abs(d) < 0.05) return { sym: '◇', color: palette.muted };
    return d > 0
      ? { sym: '▲ +' + d.toFixed(2), color: palette.status.closed }
      : { sym: '▼ '  + d.toFixed(2), color: palette.severity.high };
  };

  const latest = cols[cols.length - 1];
  const prior  = cols[cols.length - 2];
  const overallDir = direction(latest?.overall ?? null, prior?.overall ?? null);

  return (
    <Document
      title={`${tenant.display_name} — Practice Trend`}
      author={tenant.display_name}
      subject="Practice Maturity Trend"
      creator="Cyber Attainment Worksheet"
    >
      <Page size="LETTER" orientation="landscape" style={baseStyles.page}>
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · Practice Maturity Trend</Text>
        </View>
        <View style={baseStyles.pageFooter} fixed>
          <Text>As of {fmtDate(asOf.toISOString())}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        {/* Cover */}
        <View style={[baseStyles.cover, { borderBottomColor: palette.primary }]}>
          <Text style={[baseStyles.coverEyebrow, { color: palette.primary }]}>
            Trend Briefing
          </Text>
          <Text style={baseStyles.coverTitle}>NIST CSF 2.0 Practice Maturity Over Time</Text>
          <Text style={[baseStyles.coverSub, { marginTop: 6 }]}>
            Prepared for: Chief Executive Officer · Chief Financial Officer · Board Members
          </Text>

          <View style={[baseStyles.metaGrid, { marginTop: 18 }]}>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Snapshots in Trend</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {snapshots.length}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Latest Overall Practice</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {fmt2(latest?.overall ?? null)}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Direction Since Prior</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 14, fontWeight: 700, color: overallDir.color }]}>
                {overallDir.sym}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Date Range</Text>
              <Text style={baseStyles.metaVal}>
                {snapshots.length > 0
                  ? `${fmtDate(snapshots[0].taken_at)} → ${fmtDate(snapshots[snapshots.length - 1].taken_at)}`
                  : '—'}
              </Text>
            </View>
          </View>
        </View>

        {snapshots.length < 2 ? (
          <View style={[baseStyles.sectionBody, { marginTop: 16 }]}>
            <Text style={baseStyles.sectionH}>Insufficient data</Text>
            <Text style={baseStyles.para}>
              At least two snapshots are required to draw a trend. Capture
              periodic snapshots — typically before each board meeting — on
              the Snapshots tab to begin building this report.
            </Text>
          </View>
        ) : (
          <View>
            <Text style={baseStyles.sectionH}>Per-Function Practice Trend</Text>
            <Text style={[baseStyles.para, { fontSize: 9, color: palette.muted }]}>
              Each cell is the mean <Text style={{ fontWeight: 700 }}>Practice</Text> score
              for that function at the named snapshot, on the 1–5 CMM scale
              (1 Initial · 2 Repeatable · 3 Defined · 4 Managed · 5 Optimizing).
              The Δ column shows the direction since the prior snapshot.
              {' '}This view tracks Practice — the lived control posture — because
              that&apos;s the axis the Goal target measures against and the one the
              board reads as &quot;are we doing it?&quot; Policy and Goal are
              comparatively static and shown elsewhere.
              {snapshots.length > 8 && ' Showing the most recent 8 of ' + snapshots.length + ' snapshots.'}
            </Text>

            {/* Snapshot table — landscape orientation gives us width for many columns. */}
            <View style={[baseStyles.table, { marginTop: 8 }]}>
              {/* Header row: snapshot labels */}
              <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
                <Text style={[baseStyles.th, { width: '20%' }]}>Function</Text>
                {cols.map((c, i) => (
                  <Text key={c.id} style={[baseStyles.th, {
                    width: `${65 / cols.length}%`, textAlign: 'right',
                  }]} wrap={false}>
                    {c.period ?? c.label.slice(0, 12)}
                  </Text>
                ))}
                <Text style={[baseStyles.th, { width: '15%', textAlign: 'right' }]}>Δ</Text>
              </View>

              {/* Data rows */}
              {groups.map((g) => {
                const c = GROUP_COLORS[g.id] ?? { accent: palette.primary };
                const rowVals = cols.map((s) => s.by_group[g.id] ?? null);
                const dir = direction(rowVals[rowVals.length - 1], rowVals[rowVals.length - 2]);
                return (
                  <View key={g.id} style={baseStyles.tr} wrap={false}>
                    <View style={{ width: '20%', flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{
                        width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent, marginRight: 6,
                      }} />
                      <Text style={[baseStyles.td, { fontWeight: 700, color: c.accent, width: 28 }]}>{g.id}</Text>
                      <Text style={baseStyles.td}>{g.name}</Text>
                    </View>
                    {rowVals.map((v, i) => (
                      <Text key={i} style={[baseStyles.tdNum, {
                        width: `${65 / cols.length}%`,
                      }]}>{fmt2(v)}</Text>
                    ))}
                    <Text style={[baseStyles.tdNum, { width: '15%', color: dir.color, fontWeight: 700 }]}>
                      {dir.sym}
                    </Text>
                  </View>
                );
              })}

              {/* Overall row */}
              <View style={[baseStyles.tr, {
                borderTopWidth: 1, borderTopColor: palette.ink, borderBottomWidth: 0, paddingTop: 8,
              }]} wrap={false}>
                <Text style={[baseStyles.td, { width: '20%', fontWeight: 700 }]}>Overall</Text>
                {cols.map((s, i) => (
                  <Text key={s.id} style={[baseStyles.tdNum, {
                    width: `${65 / cols.length}%`, fontWeight: 700,
                  }]}>{fmt2(s.overall)}</Text>
                ))}
                <Text style={[baseStyles.tdNum, {
                  width: '15%', color: overallDir.color, fontWeight: 700,
                }]}>{overallDir.sym}</Text>
              </View>
            </View>

            {/* Snapshot context */}
            <View style={{ marginTop: 18 }}>
              <Text style={baseStyles.sectionH}>Snapshot Context</Text>
              <View style={baseStyles.table}>
                <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
                  <Text style={[baseStyles.th, { width: '18%' }]}>Period</Text>
                  <Text style={[baseStyles.th, { width: '20%' }]}>Taken</Text>
                  <Text style={[baseStyles.th, { width: '62%' }]}>Label</Text>
                </View>
                {snapshots.map((s) => (
                  <View key={s.id} style={baseStyles.tr} wrap={false}>
                    <Text style={[baseStyles.tdMono, { width: '18%' }]}>{s.period ?? '—'}</Text>
                    <Text style={[baseStyles.tdMono, { width: '20%' }]}>{fmtDate(s.taken_at)}</Text>
                    <Text style={[baseStyles.td, { width: '62%' }]}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}
      </Page>
    </Document>
  );
}
