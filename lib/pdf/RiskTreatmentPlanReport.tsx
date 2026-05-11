import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, registerFonts } from './styles';
import type { Tenant } from '@/lib/supabase/types';

/**
 * Risk Treatment Plan — board-ready briefing built from the live risk
 * register. Three sections:
 *   1. Cover with appetite-vs-exposure summary metrics.
 *   2. Heat map snapshot (residual exposure) rendered as a 5×5 ASCII-style
 *      grid of @react-pdf rectangles so we don't ship a chart engine.
 *   3. Per-risk treatment plan: each risk with its rationale, inherent →
 *      residual movement, and the treatment actions in flight.
 */

registerFonts();

const SCORE_BAND = (score: number, palette: ReturnType<typeof paletteFor>): { color: string; label: string } => {
  if (score >= 20) return { color: palette.severity.critical, label: 'Extreme' };
  if (score >= 15) return { color: palette.severity.high,     label: 'High'    };
  if (score >= 10) return { color: palette.severity.medium,   label: 'Medium'  };
  if (score >= 5)  return { color: '#EAB308',                 label: 'Low'     };
  return                  { color: palette.status.closed,     label: 'Very Low' };
};

const LIKELIHOOD = ['', 'Rare', 'Unlikely', 'Possible', 'Likely', 'Almost Certain'];
const IMPACT     = ['', 'Negligible', 'Minor', 'Moderate', 'Major', 'Catastrophic'];

const STRATEGY_LABEL: Record<string, string> = {
  accept: 'Accept', mitigate: 'Mitigate', transfer: 'Transfer', avoid: 'Avoid',
};
const STATUS_LABEL: Record<string, string> = {
  open: 'Open', in_treatment: 'In treatment',
  accepted: 'Accepted', closed: 'Closed', transferred: 'Transferred',
};

const CATEGORY_LABEL: Record<string, string> = {
  cyber: 'Cyber', operational: 'Operational', compliance: 'Compliance',
  people: 'People', supply_chain: 'Supply chain', physical: 'Physical', financial: 'Financial',
};

export interface RiskRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  category: string;
  rationale: string | null;
  inherent_likelihood: number;
  inherent_impact: number;
  inherent_score: number;
  residual_likelihood: number;
  residual_impact: number;
  residual_score: number;
  treatment_strategy: string;
  owner: string | null;
  status: string;
  linked_control_ids: string[];
}

export interface TreatmentRow {
  id: string;
  risk_id: string;
  action: string;
  detail: string | null;
  status: string;
  owner: string | null;
  due_date: string | null;
  display_order: number;
}

export function RiskTreatmentPlanReport({
  tenant, risks, treatments, asOf,
}: {
  tenant: Tenant;
  risks: RiskRow[];
  treatments: TreatmentRow[];
  asOf: Date;
}) {
  const palette = paletteFor(tenant);

  // Index treatments per risk for fast lookup, preserving display_order.
  const treatmentsByRisk = new Map<string, TreatmentRow[]>();
  for (const t of treatments) {
    const arr = treatmentsByRisk.get(t.risk_id) ?? [];
    arr.push(t);
    treatmentsByRisk.set(t.risk_id, arr);
  }
  for (const arr of treatmentsByRisk.values()) {
    arr.sort((a, b) => a.display_order - b.display_order);
  }

  // Cover metrics.
  const sorted = [...risks].sort((a, b) => b.residual_score - a.residual_score);
  const total = risks.length;
  const extreme = risks.filter((r) => r.residual_score >= 20).length;
  const high    = risks.filter((r) => r.residual_score >= 15 && r.residual_score < 20).length;
  const inFlight = treatments.filter((t) => t.status === 'In Progress').length;
  const complete = treatments.filter((t) => t.status === 'Complete').length;

  // Residual heat map: 5x5 grid keyed by [likelihood][impact] → count.
  const grid: number[][] = [[], [], [], [], [], []]; // 1..5
  for (let l = 1; l <= 5; l++) {
    grid[l] = [0, 0, 0, 0, 0, 0];
  }
  for (const r of risks) {
    grid[r.residual_likelihood][r.residual_impact]++;
  }

  return (
    <Document
      title={`${tenant.display_name} — Risk Treatment Plan`}
      author={tenant.display_name}
      subject="Risk Treatment Plan"
      creator="Cyber Attainment Worksheet"
    >
      {/* ===================================================================
          Page 1: Cover + heat map
          =================================================================== */}
      <Page size="LETTER" style={baseStyles.page}>
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · Risk Treatment Plan</Text>
        </View>
        <View style={baseStyles.pageFooter} fixed>
          <Text>As of {fmtDate(asOf.toISOString())}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        <View style={[baseStyles.cover, { borderBottomColor: palette.primary }]}>
          <Text style={[baseStyles.coverEyebrow, { color: palette.primary }]}>
            Risk Treatment Plan
          </Text>
          <Text style={baseStyles.coverTitle}>
            What we worry about · what we&apos;re doing about it
          </Text>
          <Text style={[baseStyles.coverSub, { marginTop: 6 }]}>
            Prepared for: Chief Executive Officer · Chief Financial Officer · Board Members
          </Text>

          <View style={[baseStyles.metaGrid, { marginTop: 18 }]}>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Total Risks Tracked</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {total}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>High &amp; Extreme (residual)</Text>
              <Text style={[baseStyles.metaVal, {
                fontSize: 18, fontWeight: 700,
                color: (extreme + high) > 0 ? palette.severity.high : palette.status.closed,
              }]}>
                {extreme + high}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                {extreme} extreme · {high} high
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Treatment Actions in Flight</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {inFlight}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                {complete} previously completed
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Treatment Coverage</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {treatments.length > 0
                  ? `${Math.round((complete / treatments.length) * 100)}%`
                  : '—'}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>actions complete vs. total</Text>
            </View>
          </View>
        </View>

        {/* Heat map */}
        <Text style={baseStyles.sectionH}>Residual Exposure — Heat Map</Text>
        <Text style={{ fontSize: 10, color: palette.muted, marginBottom: 10 }}>
          Each cell shows the count of risks landing at that likelihood × impact after treatment.
          Cells coloured by score band: Extreme 20-25 · High 15-19 · Medium 10-14 · Low 5-9 · Very Low 1-4.
        </Text>

        <View style={{ marginLeft: 80 }}>
          {([5, 4, 3, 2, 1]).map((l) => (
            <View key={l} style={{ flexDirection: 'row', alignItems: 'stretch', marginBottom: 4 }}>
              <View style={{ width: 90, justifyContent: 'center' }}>
                <Text style={{
                  fontFamily: 'Helvetica-Bold', fontSize: 8, fontWeight: 600,
                  color: palette.muted, textTransform: 'uppercase', letterSpacing: 1,
                  textAlign: 'right', paddingRight: 6,
                }}>
                  {LIKELIHOOD[l]} ({l})
                </Text>
              </View>
              {[1, 2, 3, 4, 5].map((i) => {
                const score = l * i;
                const band = SCORE_BAND(score, palette);
                const count = grid[l][i];
                return (
                  <View key={i} style={{
                    flex: 1, height: 38, marginRight: 4,
                    backgroundColor: band.color, borderRadius: 3,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontWeight: 700, fontSize: 14 }}>
                      {count > 0 ? count : ''}
                    </Text>
                    <Text style={{ color: '#FFFFFF', fontSize: 7, opacity: 0.8, position: 'absolute', top: 2, right: 4 }}>
                      {score}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
          {/* X-axis labels */}
          <View style={{ flexDirection: 'row', marginTop: 4 }}>
            <View style={{ width: 90 }} />
            {[1, 2, 3, 4, 5].map((i) => (
              <View key={i} style={{ flex: 1, marginRight: 4, alignItems: 'center' }}>
                <Text style={{
                  fontFamily: 'Helvetica-Bold', fontSize: 8, fontWeight: 600,
                  color: palette.muted, textTransform: 'uppercase', letterSpacing: 1,
                }}>
                  {IMPACT[i]} ({i})
                </Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={[baseStyles.sectionH, { marginTop: 24 }]}>Top Residual Risks</Text>
        <View style={baseStyles.table}>
          <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
            <Text style={[baseStyles.th, { width: '8%' }]}>Code</Text>
            <Text style={[baseStyles.th, { width: '40%' }]}>Risk</Text>
            <Text style={[baseStyles.th, { width: '14%' }]}>Category</Text>
            <Text style={[baseStyles.th, { width: '12%', textAlign: 'right' }]}>Inherent</Text>
            <Text style={[baseStyles.th, { width: '12%', textAlign: 'right' }]}>Residual</Text>
            <Text style={[baseStyles.th, { width: '14%' }]}>Strategy</Text>
          </View>
          {sorted.slice(0, 12).map((r) => {
            const inh = SCORE_BAND(r.inherent_score, palette);
            const res = SCORE_BAND(r.residual_score, palette);
            return (
              <View key={r.id} style={baseStyles.tr} wrap={false}>
                <Text style={[baseStyles.tdMono, { width: '8%' }]}>{r.code}</Text>
                <Text style={[baseStyles.td, { width: '40%', fontWeight: 700 }]}>{r.title}</Text>
                <Text style={[baseStyles.td, { width: '14%', color: palette.muted }]}>{CATEGORY_LABEL[r.category] ?? r.category}</Text>
                <Text style={[baseStyles.td, { width: '12%', textAlign: 'right', color: inh.color, fontWeight: 700 }]}>
                  {r.inherent_score} ({inh.label})
                </Text>
                <Text style={[baseStyles.td, { width: '12%', textAlign: 'right', color: res.color, fontWeight: 700 }]}>
                  {r.residual_score} ({res.label})
                </Text>
                <Text style={[baseStyles.td, { width: '14%' }]}>{STRATEGY_LABEL[r.treatment_strategy] ?? r.treatment_strategy}</Text>
              </View>
            );
          })}
        </View>
      </Page>

      {/* ===================================================================
          Page 2+: Per-risk detail with treatments
          =================================================================== */}
      <Page size="LETTER" style={baseStyles.page}>
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · Risk Treatment Plan</Text>
        </View>
        <View style={baseStyles.pageFooter} fixed>
          <Text>As of {fmtDate(asOf.toISOString())}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        <Text style={baseStyles.sectionH}>Risk-by-Risk Treatment Detail</Text>
        <Text style={{ fontSize: 10, color: palette.muted, marginBottom: 12 }}>
          Risks listed by residual score (highest first). Each entry shows the risk rationale,
          the inherent → residual movement we credit to the treatment plan, and the actions
          in flight.
        </Text>

        {sorted.map((r) => {
          const inh = SCORE_BAND(r.inherent_score, palette);
          const res = SCORE_BAND(r.residual_score, palette);
          const ts = treatmentsByRisk.get(r.id) ?? [];
          return (
            <View key={r.id} wrap={false} style={{
              marginBottom: 14, paddingBottom: 8,
              borderLeftWidth: 3, borderLeftColor: res.color, paddingLeft: 12,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 4 }}>
                <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9, color: palette.muted, marginRight: 8 }}>
                  {r.code}
                </Text>
                <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 12, fontWeight: 700, color: palette.ink, flex: 1 }}>
                  {r.title}
                </Text>
                <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9, color: palette.muted }}>
                  {CATEGORY_LABEL[r.category] ?? r.category} · {STATUS_LABEL[r.status] ?? r.status}
                </Text>
              </View>

              {r.description && (
                <Text style={{ fontSize: 10, color: palette.body, marginBottom: 4 }}>{r.description}</Text>
              )}
              {r.rationale && (
                <Text style={{ fontSize: 9, color: palette.muted, fontStyle: 'italic', marginBottom: 4 }}>
                  {r.rationale}
                </Text>
              )}

              {/* Inherent → Residual movement */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 6 }}>
                <Text style={{ fontSize: 9, color: palette.muted, marginRight: 6 }}>Exposure:</Text>
                <Text style={{ fontSize: 10, color: inh.color, fontWeight: 700, marginRight: 4 }}>
                  Inherent {r.inherent_score} ({inh.label})
                </Text>
                <Text style={{ fontSize: 10, color: palette.muted, marginHorizontal: 4 }}>→</Text>
                <Text style={{ fontSize: 10, color: res.color, fontWeight: 700, marginRight: 8 }}>
                  Residual {r.residual_score} ({res.label})
                </Text>
                <Text style={{ fontSize: 9, color: palette.muted }}>
                  · Strategy: {STRATEGY_LABEL[r.treatment_strategy] ?? r.treatment_strategy}
                  {r.owner ? ` · Owner: ${r.owner}` : ''}
                </Text>
              </View>

              {/* Treatments */}
              {ts.length === 0 ? (
                <Text style={{ fontSize: 9, color: palette.muted, fontStyle: 'italic' }}>
                  No treatment actions documented for this risk.
                </Text>
              ) : (
                <View style={{ marginTop: 2 }}>
                  {ts.map((t) => {
                    const statusColor =
                      t.status === 'Complete' ? palette.status.closed
                      : t.status === 'In Progress' ? palette.status.contained
                      : t.status === 'Blocked' ? palette.severity.high
                      : palette.muted;
                    return (
                      <View key={t.id} style={{ flexDirection: 'row', marginBottom: 3 }} wrap={false}>
                        <Text style={{ fontSize: 9, color: statusColor, fontWeight: 700, width: 70 }}>
                          {t.status}
                        </Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 9, color: palette.ink }}>{t.action}</Text>
                          {t.detail && (
                            <Text style={{ fontSize: 8, color: palette.muted, marginTop: 1 }}>
                              {t.detail.length > 220 ? t.detail.slice(0, 220) + '…' : t.detail}
                            </Text>
                          )}
                        </View>
                        <Text style={{ fontSize: 8, color: palette.muted, width: 90, textAlign: 'right' }}>
                          {t.owner ?? '—'}{t.due_date ? ` · ${t.due_date}` : ''}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {r.linked_control_ids.length > 0 && (
                <Text style={{ fontSize: 8, color: palette.muted, marginTop: 6 }}>
                  Linked NIST CSF controls: {r.linked_control_ids.join(', ')}
                </Text>
              )}
            </View>
          );
        })}

        {/* Signature block */}
        <View style={baseStyles.signBlock} wrap={false}>
          <View style={baseStyles.signCol}>
            <View style={baseStyles.signLine} />
            <Text style={baseStyles.signLabel}>Risk Owner / CIO</Text>
          </View>
          <View style={baseStyles.signCol}>
            <View style={baseStyles.signLine} />
            <Text style={baseStyles.signLabel}>Executive Sponsor</Text>
          </View>
          <View style={baseStyles.signCol}>
            <View style={baseStyles.signLine} />
            <Text style={baseStyles.signLabel}>Date</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
