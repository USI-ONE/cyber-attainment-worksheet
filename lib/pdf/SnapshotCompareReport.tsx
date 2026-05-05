import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, fmtDateTime, registerFonts } from './styles';
import { GROUP_COLORS } from '@/lib/scoring';
import type { Tenant } from '@/lib/supabase/types';

/**
 * Executive Snapshot Compare — side-by-side delta between two snapshots
 * (or one snapshot vs. current state). Designed for the audit-trail
 * conversation: "between Q1 and Q2 board packs, what actually moved?"
 *
 * Layout:
 *   - Cover with both snapshot labels + dates + overall pra/gol delta
 *   - Per-function table: prior pra/gol → current pra/gol → delta
 *   - Per-control changes: only rows where pra or gol actually shifted
 */

registerFonts();

export interface CompareSnapshotMeta {
  id: string | 'current';
  label: string;
  taken_at: string | null;
}

export interface CompareScore {
  control_id: string;
  pol: number | null;
  pra: number | null;
  gol: number | null;
}

export function SnapshotCompareReport({
  tenant,
  fromMeta,
  toMeta,
  fromScores,
  toScores,
  groups,
  asOf,
}: {
  tenant: Tenant;
  fromMeta: CompareSnapshotMeta;
  toMeta: CompareSnapshotMeta;
  fromScores: CompareScore[];
  toScores: CompareScore[];
  groups: { id: string; name: string }[];
  asOf: Date;
}) {
  const palette = paletteFor(tenant);
  const fmt2 = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(2));

  // Build maps for fast lookup and delta math.
  const fromMap = new Map(fromScores.map((r) => [r.control_id, r]));
  const toMap = new Map(toScores.map((r) => [r.control_id, r]));

  // Per-function rollup: avg pra and gol on each side, plus delta.
  type FnRow = {
    id: string; name: string; accent: string;
    fromPra: number | null; toPra: number | null; deltaPra: number | null;
    fromGol: number | null; toGol: number | null; deltaGol: number | null;
  };
  const fnRows: FnRow[] = groups.map((g) => {
    const c = GROUP_COLORS[g.id]?.accent ?? palette.primary;
    const fromArr = fromScores.filter((r) => r.control_id.startsWith(g.id + '.'));
    const toArr   = toScores.filter((r) => r.control_id.startsWith(g.id + '.'));
    const avg = (arr: CompareScore[], k: 'pra' | 'gol') => {
      const v = arr.map((r) => r[k]).filter((x): x is number => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const fp = avg(fromArr, 'pra'), tp = avg(toArr, 'pra');
    const fg = avg(fromArr, 'gol'), tg = avg(toArr, 'gol');
    return {
      id: g.id, name: g.name, accent: c,
      fromPra: fp, toPra: tp, deltaPra: fp != null && tp != null ? tp - fp : null,
      fromGol: fg, toGol: tg, deltaGol: fg != null && tg != null ? tg - fg : null,
    };
  });

  // Per-control changes: only rows where pra or gol moved.
  const changedControls: Array<{
    control_id: string;
    fromPra: number | null; toPra: number | null;
    fromGol: number | null; toGol: number | null;
  }> = [];
  const allIds = new Set<string>([...fromMap.keys(), ...toMap.keys()]);
  for (const cid of Array.from(allIds).sort()) {
    const f = fromMap.get(cid); const t = toMap.get(cid);
    const fp = f?.pra ?? null; const tp = t?.pra ?? null;
    const fg = f?.gol ?? null; const tg = t?.gol ?? null;
    if (fp !== tp || fg !== tg) {
      changedControls.push({ control_id: cid, fromPra: fp, toPra: tp, fromGol: fg, toGol: tg });
    }
  }

  // Overall deltas
  const overallFromPra = avgArr(fromScores.map((r) => r.pra));
  const overallToPra   = avgArr(toScores.map((r) => r.pra));
  const overallDeltaPra = overallFromPra != null && overallToPra != null ? overallToPra - overallFromPra : null;

  const deltaColor = (d: number | null) => {
    if (d == null) return palette.muted;
    if (Math.abs(d) < 0.05) return palette.muted;
    return d > 0 ? palette.status.closed : palette.severity.high;
  };
  const deltaSym = (d: number | null) => {
    if (d == null) return '—';
    if (Math.abs(d) < 0.05) return '◇';
    return (d > 0 ? '▲ +' : '▼ ') + d.toFixed(2);
  };

  return (
    <Document
      title={`${tenant.display_name} — Snapshot Compare`}
      author={tenant.display_name}
      subject="Snapshot Compare Briefing"
      creator="Cyber Attainment Worksheet"
    >
      <Page size="LETTER" style={baseStyles.page}>
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · Snapshot Compare</Text>
        </View>
        <View style={baseStyles.pageFooter} fixed>
          <Text>As of {fmtDate(asOf.toISOString())}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        {/* Cover */}
        <View style={[baseStyles.cover, { borderBottomColor: palette.primary }]}>
          <Text style={[baseStyles.coverEyebrow, { color: palette.primary }]}>
            Snapshot Compare
          </Text>
          <Text style={baseStyles.coverTitle}>What Moved Between Two Snapshots</Text>
          <Text style={[baseStyles.coverSub, { marginTop: 6 }]}>
            Prepared for: Chief Executive Officer · Chief Financial Officer · Board Members
          </Text>

          <View style={[baseStyles.metaGrid, { marginTop: 18 }]}>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>From (prior)</Text>
              <Text style={[baseStyles.metaVal, { fontWeight: 700 }]}>{fromMeta.label}</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 9, color: palette.muted }]}>
                {fromMeta.taken_at ? fmtDateTime(fromMeta.taken_at) : 'no timestamp'}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>To (current)</Text>
              <Text style={[baseStyles.metaVal, { fontWeight: 700 }]}>{toMeta.label}</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 9, color: palette.muted }]}>
                {toMeta.taken_at ? fmtDateTime(toMeta.taken_at) : 'in-flight (current state)'}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Overall Practice Δ</Text>
              <Text style={[baseStyles.metaVal, {
                fontSize: 18, fontWeight: 700, color: deltaColor(overallDeltaPra),
              }]}>
                {deltaSym(overallDeltaPra)}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                {fmt2(overallFromPra)} → {fmt2(overallToPra)}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Controls Changed</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {changedControls.length}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                {fromScores.length + toScores.length > 0
                  ? `${changedControls.length} of ${Math.max(fromScores.length, toScores.length)} subcontrols`
                  : 'no scoring data'}
              </Text>
            </View>
          </View>
        </View>

        {/* Per-function delta */}
        <Text style={baseStyles.sectionH}>1. Per-Function Practice &amp; Goal Movement</Text>
        <View style={baseStyles.table}>
          <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
            <Text style={[baseStyles.th, { width: '32%' }]}>Function</Text>
            <Text style={[baseStyles.th, { width: '11%', textAlign: 'right' }]}>Pra (prior)</Text>
            <Text style={[baseStyles.th, { width: '11%', textAlign: 'right' }]}>Pra (current)</Text>
            <Text style={[baseStyles.th, { width: '13%', textAlign: 'right' }]}>Δ Pra</Text>
            <Text style={[baseStyles.th, { width: '11%', textAlign: 'right' }]}>Goal (prior)</Text>
            <Text style={[baseStyles.th, { width: '11%', textAlign: 'right' }]}>Goal (current)</Text>
            <Text style={[baseStyles.th, { width: '11%', textAlign: 'right' }]}>Δ Goal</Text>
          </View>
          {fnRows.map((r) => (
            <View key={r.id} style={baseStyles.tr} wrap={false}>
              <View style={{ width: '32%', flexDirection: 'row', alignItems: 'center' }}>
                <View style={{
                  width: 6, height: 6, borderRadius: 3, backgroundColor: r.accent, marginRight: 8,
                }} />
                <Text style={[baseStyles.td, { fontWeight: 700, color: r.accent, width: 28 }]}>{r.id}</Text>
                <Text style={baseStyles.td}>{r.name}</Text>
              </View>
              <Text style={[baseStyles.tdNum, { width: '11%' }]}>{fmt2(r.fromPra)}</Text>
              <Text style={[baseStyles.tdNum, { width: '11%' }]}>{fmt2(r.toPra)}</Text>
              <Text style={[baseStyles.tdNum, { width: '13%', color: deltaColor(r.deltaPra), fontWeight: 700 }]}>
                {deltaSym(r.deltaPra)}
              </Text>
              <Text style={[baseStyles.tdNum, { width: '11%' }]}>{fmt2(r.fromGol)}</Text>
              <Text style={[baseStyles.tdNum, { width: '11%' }]}>{fmt2(r.toGol)}</Text>
              <Text style={[baseStyles.tdNum, { width: '11%', color: deltaColor(r.deltaGol), fontWeight: 700 }]}>
                {deltaSym(r.deltaGol)}
              </Text>
            </View>
          ))}
        </View>

        {/* Per-control changes */}
        {changedControls.length > 0 ? (
          <View>
            <Text style={baseStyles.sectionH}>
              2. Controls That Moved ({changedControls.length})
            </Text>
            <Text style={[baseStyles.para, { fontSize: 9, color: palette.muted }]}>
              Only subcontrols whose Practice or Goal score changed between the two snapshots.
            </Text>
            <View style={baseStyles.table}>
              <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
                <Text style={[baseStyles.th, { width: '20%' }]}>Control</Text>
                <Text style={[baseStyles.th, { width: '14%', textAlign: 'right' }]}>Pra prior</Text>
                <Text style={[baseStyles.th, { width: '14%', textAlign: 'right' }]}>Pra current</Text>
                <Text style={[baseStyles.th, { width: '14%', textAlign: 'right' }]}>Δ Pra</Text>
                <Text style={[baseStyles.th, { width: '12%', textAlign: 'right' }]}>Goal prior</Text>
                <Text style={[baseStyles.th, { width: '12%', textAlign: 'right' }]}>Goal current</Text>
                <Text style={[baseStyles.th, { width: '14%', textAlign: 'right' }]}>Δ Goal</Text>
              </View>
              {changedControls.map((c) => {
                const dPra = c.fromPra != null && c.toPra != null ? c.toPra - c.fromPra : null;
                const dGol = c.fromGol != null && c.toGol != null ? c.toGol - c.fromGol : null;
                return (
                  <View key={c.control_id} style={baseStyles.tr} wrap={false}>
                    <Text style={[baseStyles.td, { width: '20%', fontWeight: 700 }]}>{c.control_id}</Text>
                    <Text style={[baseStyles.tdNum, { width: '14%' }]}>{fmt2(c.fromPra)}</Text>
                    <Text style={[baseStyles.tdNum, { width: '14%' }]}>{fmt2(c.toPra)}</Text>
                    <Text style={[baseStyles.tdNum, { width: '14%', color: deltaColor(dPra), fontWeight: 700 }]}>
                      {deltaSym(dPra)}
                    </Text>
                    <Text style={[baseStyles.tdNum, { width: '12%' }]}>{fmt2(c.fromGol)}</Text>
                    <Text style={[baseStyles.tdNum, { width: '12%' }]}>{fmt2(c.toGol)}</Text>
                    <Text style={[baseStyles.tdNum, { width: '14%', color: deltaColor(dGol), fontWeight: 700 }]}>
                      {deltaSym(dGol)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : (
          <View>
            <Text style={baseStyles.sectionH}>2. Controls That Moved</Text>
            <Text style={baseStyles.para}>
              No subcontrol-level changes detected between the two snapshots.
            </Text>
          </View>
        )}
      </Page>
    </Document>
  );
}

function avgArr(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
