import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, registerFonts } from './styles';
import { GROUP_COLORS } from '@/lib/scoring';
import type { Tenant } from '@/lib/supabase/types';

/**
 * Executive Trend Briefing — three-axis maturity trend over time.
 *
 * The previous version of this report only plotted Practice. The board uses
 * the trend to see "did we improve since last quarter," and improvements can
 * land on any of the three axes — Policy (we updated the policy doc),
 * Practice (we ran an assessment), or Goal (we raised the bar). Tracking
 * only Practice meant a Policy-version bump (e.g., USI v1.0 → v2.0) was
 * invisible here. This version shows all three lines per function.
 *
 * Layout: each NIST CSF function gets a three-row block (Policy, Practice,
 * Goal), and an Overall block at the bottom shows the headline trend the
 * board reads first.
 */

registerFonts();

export interface TrendSnapshot {
  id: string;
  label: string;
  period: string | null;
  taken_at: string;
  /** group_id -> per-axis average, or null if no data on that axis */
  by_group: Record<string, { pol: number | null; pra: number | null; gol: number | null }>;
  overall_pol: number | null;
  overall_pra: number | null;
  overall_gol: number | null;
}

const AXES = [
  { key: 'pol' as const, label: 'Policy',   colorKey: 'pol' as const },
  { key: 'pra' as const, label: 'Practice', colorKey: 'pra' as const },
  { key: 'gol' as const, label: 'Goal',     colorKey: 'gol' as const },
];

// Axis colors match the radar / executive report convention so the board sees
// the same hue across every artifact.
const AXIS_COLORS: Record<'pol' | 'pra' | 'gol', string> = {
  pol: '#A6873B',
  pra: '#B45309',
  gol: '#15803D',
};

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

  // Show at most the most recent 8 snapshot columns so the table stays
  // readable on landscape Letter; older snapshots compress to a footnote.
  const cols = snapshots.slice(-8);

  // Direction-since-prior helper, used both on the cover and at the right
  // edge of every data row.
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
  const polDir = direction(latest?.overall_pol ?? null, prior?.overall_pol ?? null);
  const praDir = direction(latest?.overall_pra ?? null, prior?.overall_pra ?? null);
  const golDir = direction(latest?.overall_gol ?? null, prior?.overall_gol ?? null);

  return (
    <Document
      title={`${tenant.display_name} — Maturity Trend`}
      author={tenant.display_name}
      subject="Three-Axis Maturity Trend"
      creator="Cyber Attainment Worksheet"
    >
      <Page size="LETTER" orientation="landscape" style={baseStyles.page}>
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · Maturity Trend</Text>
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
          <Text style={baseStyles.coverTitle}>NIST CSF 2.0 Maturity Over Time</Text>
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
              <Text style={baseStyles.metaLabel}>Date Range</Text>
              <Text style={baseStyles.metaVal}>
                {snapshots.length > 0
                  ? `${fmtDate(snapshots[0].taken_at)} → ${fmtDate(snapshots[snapshots.length - 1].taken_at)}`
                  : '—'}
              </Text>
            </View>

            {/* Three direction tiles — one per axis. */}
            <View style={baseStyles.metaItem}>
              <Text style={[baseStyles.metaLabel, { color: AXIS_COLORS.pol }]}>Policy (overall)</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 16, fontWeight: 700 }]}>
                {fmt2(latest?.overall_pol ?? null)}
              </Text>
              <Text style={{ fontSize: 9, fontWeight: 700, color: polDir.color }}>{polDir.sym}</Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={[baseStyles.metaLabel, { color: AXIS_COLORS.pra }]}>Practice (overall)</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 16, fontWeight: 700 }]}>
                {fmt2(latest?.overall_pra ?? null)}
              </Text>
              <Text style={{ fontSize: 9, fontWeight: 700, color: praDir.color }}>{praDir.sym}</Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={[baseStyles.metaLabel, { color: AXIS_COLORS.gol }]}>Goal (overall)</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 16, fontWeight: 700 }]}>
                {fmt2(latest?.overall_gol ?? null)}
              </Text>
              <Text style={{ fontSize: 9, fontWeight: 700, color: golDir.color }}>{golDir.sym}</Text>
            </View>
          </View>
        </View>

        {snapshots.length < 2 ? (
          <View style={[baseStyles.sectionBody, { marginTop: 16 }]}>
            <Text style={baseStyles.sectionH}>Insufficient data</Text>
            <Text style={baseStyles.para}>
              At least two snapshots are required to draw a trend. Capture
              periodic snapshots — typically before each board meeting, after
              each policy revision, and whenever the assessment is rerun — on
              the Snapshots tab to begin building this report.
            </Text>
          </View>
        ) : (
          <View>
            <Text style={baseStyles.sectionH}>Per-Function Three-Axis Trend</Text>
            <Text style={[baseStyles.para, { fontSize: 9, color: palette.muted }]}>
              Each function is shown across all three axes — Policy (what we
              have written), Practice (what we actually do), Goal (where we
              are working toward). All three are scored on the 1–5 CMM scale
              (1 Initial · 2 Repeatable · 3 Defined · 4 Managed · 5 Optimizing).
              The Δ column shows the direction since the prior snapshot.
              An improvement to any axis — for example, a new policy version
              raising Policy scores — shows up as a green ▲ in that axis row.
              {snapshots.length > 8 && ' Showing the most recent 8 of ' + snapshots.length + ' snapshots.'}
            </Text>

            {/* Snapshot table — three rows per function (Pol / Pra / Gol). */}
            <View style={[baseStyles.table, { marginTop: 8 }]}>
              {/* Header row: snapshot labels */}
              <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
                <Text style={[baseStyles.th, { width: '14%' }]}>Function</Text>
                <Text style={[baseStyles.th, { width: '8%' }]}>Axis</Text>
                {cols.map((c) => (
                  <Text key={c.id} style={[baseStyles.th, {
                    width: `${65 / cols.length}%`, textAlign: 'right',
                  }]} wrap={false}>
                    {c.period ?? c.label.slice(0, 12)}
                  </Text>
                ))}
                <Text style={[baseStyles.th, { width: '13%', textAlign: 'right' }]}>Δ</Text>
              </View>

              {/* Per-function blocks: function name once, then Pol / Pra / Gol rows beneath. */}
              {groups.map((g) => {
                const c = GROUP_COLORS[g.id] ?? { accent: palette.primary };
                return (
                  <View key={g.id} wrap={false}>
                    {AXES.map((axis, axisIdx) => {
                      const rowVals = cols.map((s) => s.by_group[g.id]?.[axis.key] ?? null);
                      const dir = direction(rowVals[rowVals.length - 1], rowVals[rowVals.length - 2]);
                      return (
                        <View key={axis.key} style={[baseStyles.tr, {
                          // Light divider only at the bottom of each function block
                          borderBottomWidth: axisIdx === AXES.length - 1 ? 0.5 : 0,
                          borderBottomColor: palette.bgMute,
                          paddingTop: 3, paddingBottom: 3,
                        }]}>
                          {/* Function label only on the first axis row in the block */}
                          <View style={{ width: '14%', flexDirection: 'row', alignItems: 'center' }}>
                            {axisIdx === 0 ? (
                              <>
                                <View style={{
                                  width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent, marginRight: 6,
                                }} />
                                <Text style={[baseStyles.td, { fontWeight: 700, color: c.accent }]}>{g.id}</Text>
                              </>
                            ) : null}
                          </View>
                          <Text style={[baseStyles.td, {
                            width: '8%', fontSize: 9, fontWeight: 600, color: AXIS_COLORS[axis.colorKey],
                          }]}>{axis.label}</Text>
                          {rowVals.map((v, i) => (
                            <Text key={i} style={[baseStyles.tdNum, {
                              width: `${65 / cols.length}%`,
                              color: AXIS_COLORS[axis.colorKey],
                              fontSize: 9,
                            }]}>{fmt2(v)}</Text>
                          ))}
                          <Text style={[baseStyles.tdNum, {
                            width: '13%', color: dir.color, fontWeight: 700, fontSize: 9,
                          }]}>{dir.sym}</Text>
                        </View>
                      );
                    })}
                  </View>
                );
              })}

              {/* Overall block — same shape, but bold and bordered top. */}
              <View wrap={false} style={{
                borderTopWidth: 1, borderTopColor: palette.ink, marginTop: 4, paddingTop: 4,
              }}>
                {AXES.map((axis) => {
                  const overallKey = axis.key === 'pol' ? 'overall_pol' : axis.key === 'pra' ? 'overall_pra' : 'overall_gol';
                  const rowVals = cols.map((s) => (s[overallKey] as number | null) ?? null);
                  const dir = direction(rowVals[rowVals.length - 1], rowVals[rowVals.length - 2]);
                  return (
                    <View key={axis.key} style={[baseStyles.tr, { borderBottomWidth: 0, paddingTop: 3, paddingBottom: 3 }]}>
                      <Text style={[baseStyles.td, { width: '14%', fontWeight: 700 }]}>
                        {axis.key === 'pol' ? 'Overall' : ''}
                      </Text>
                      <Text style={[baseStyles.td, {
                        width: '8%', fontSize: 9, fontWeight: 700, color: AXIS_COLORS[axis.colorKey],
                      }]}>{axis.label}</Text>
                      {rowVals.map((v, i) => (
                        <Text key={i} style={[baseStyles.tdNum, {
                          width: `${65 / cols.length}%`,
                          color: AXIS_COLORS[axis.colorKey],
                          fontWeight: 700, fontSize: 10,
                        }]}>{fmt2(v)}</Text>
                      ))}
                      <Text style={[baseStyles.tdNum, {
                        width: '13%', color: dir.color, fontWeight: 700, fontSize: 10,
                      }]}>{dir.sym}</Text>
                    </View>
                  );
                })}
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
