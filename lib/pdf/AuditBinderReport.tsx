import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, registerFonts } from './styles';
import { GROUP_COLORS } from '@/lib/scoring';
import type { Tenant, FrameworkDefinition } from '@/lib/supabase/types';

/**
 * Audit Binder — the auditor-ready packet. Walks every control in the
 * active framework and, for each one, prints:
 *
 *   - Control ID + outcome statement
 *   - Current Policy / Practice / Goal score (color-coded)
 *   - Assessment response (Q1/Q2/Q3 + Q4 improvement) if recorded
 *   - Linked risks (code + title + residual score)
 *   - Linked policy documents (title + version)
 *   - Linked evidence artifacts (title + category + collected date)
 *   - Linked DR plans (name + tier + last test result)
 *   - Linked IR playbooks (name + category + last reviewed)
 *
 * Controls with NO score and NO links render as a single "Not yet
 * assessed" row so an auditor immediately sees coverage gaps without
 * paging through silence.
 *
 * The cross-references are exactly the linkages the Evidence Library
 * exposes in its detail editor — this report is what those linkages
 * are FOR. Populate evidence + link it to controls; the binder
 * assembles automatically.
 */

registerFonts();

// =============================================================================
// Types — handed in by the API route, indexed by control_id where useful
// =============================================================================

export interface BinderScore {
  pol: number | null;
  pra: number | null;
  gol: number | null;
  owner: string | null;
  status: string | null;
  notes: string | null;
}

export interface BinderAssessmentResponse {
  q1_documented: string | null;
  q2_followed: string | null;
  q3_measured: string | null;
  q4_improvement: string | null;
  computed_score: number | null;
}

export interface BinderRisk {
  code: string;
  title: string;
  residual_score: number;
  status: string;
}

export interface BinderPolicyDoc {
  title: string;
  version: string | null;
  status: string;
  effective_date: string | null;
}

export interface BinderEvidence {
  title: string;
  category: string;
  filename: string | null;
  collected_date: string | null;
  retention_until: string | null;
  status: string;
}

export interface BinderDrPlan {
  name: string;
  tier: number;
  last_tested: string | null;
  last_test_result: string | null;
}

export interface BinderIrPlaybook {
  name: string;
  category: string;
  last_reviewed: string | null;
}

export interface BinderControlData {
  control_id: string;
  outcome: string;
  group_id: string;
  group_name: string;
  category_id: string;
  category_name: string;

  score: BinderScore | null;
  assessment: BinderAssessmentResponse | null;
  risks: BinderRisk[];
  policies: BinderPolicyDoc[];
  evidence: BinderEvidence[];
  dr_plans: BinderDrPlan[];
  ir_playbooks: BinderIrPlaybook[];
  incident_count: number;
}

// =============================================================================
// Helpers
// =============================================================================

const TIER_LABEL = ['—', 'Initial', 'Repeatable', 'Defined', 'Managed', 'Optimizing'];

function tierColor(score: number | null, palette: ReturnType<typeof paletteFor>): string {
  if (score == null) return palette.muted;
  if (score >= 4.5) return palette.status.closed;
  if (score >= 3.5) return '#0EA5E9';
  if (score >= 2.5) return palette.severity.medium;
  if (score >= 1.5) return palette.severity.high;
  return palette.severity.critical;
}

function fmtScore(n: number | null): string {
  if (n == null) return '—';
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(1);
}

function bandLabel(score: number | null): string {
  if (score == null) return 'Not scored';
  const tier = Math.round(score);
  return TIER_LABEL[Math.max(1, Math.min(5, tier))] ?? '—';
}

function residualBand(score: number, palette: ReturnType<typeof paletteFor>): string {
  if (score >= 20) return palette.severity.critical;
  if (score >= 15) return palette.severity.high;
  if (score >= 10) return palette.severity.medium;
  if (score >= 5)  return '#EAB308';
  return palette.status.closed;
}

// =============================================================================
// Main report
// =============================================================================

export function AuditBinderReport({
  tenant, definition, controls, asOf,
}: {
  tenant: Tenant;
  definition: FrameworkDefinition;
  controls: BinderControlData[];
  asOf: Date;
}) {
  const palette = paletteFor(tenant);
  const frameworkName = definition.framework.display_name;

  // Roll-ups for the executive summary.
  const total = controls.length;
  const scored = controls.filter((c) => c.score?.pra != null).length;
  const withEvidence = controls.filter((c) => c.evidence.length > 0).length;
  const withPolicy   = controls.filter((c) => c.policies.length > 0).length;
  const withAnyLink  = controls.filter((c) =>
    c.evidence.length > 0 || c.policies.length > 0 || c.risks.length > 0 ||
    c.dr_plans.length > 0 || c.ir_playbooks.length > 0,
  ).length;

  // Per-function averages for the cover.
  type FnAgg = { id: string; name: string; polSum: number; polN: number; praSum: number; praN: number; golSum: number; golN: number; total: number; withEv: number };
  const byFn = new Map<string, FnAgg>();
  for (const c of controls) {
    let agg = byFn.get(c.group_id);
    if (!agg) {
      agg = { id: c.group_id, name: c.group_name, polSum: 0, polN: 0, praSum: 0, praN: 0, golSum: 0, golN: 0, total: 0, withEv: 0 };
      byFn.set(c.group_id, agg);
    }
    agg.total++;
    if (c.score?.pol != null) { agg.polSum += c.score.pol; agg.polN++; }
    if (c.score?.pra != null) { agg.praSum += c.score.pra; agg.praN++; }
    if (c.score?.gol != null) { agg.golSum += c.score.gol; agg.golN++; }
    if (c.evidence.length > 0) agg.withEv++;
  }
  const fnRollup = Array.from(byFn.values());

  const overallPra = (() => {
    const a = controls.reduce((acc, c) => {
      if (c.score?.pra != null) { acc.sum += c.score.pra; acc.n++; }
      return acc;
    }, { sum: 0, n: 0 });
    return a.n ? a.sum / a.n : null;
  })();

  // Sort controls by function order (definition order is GV/ID/PR/DE/RS/RC),
  // then category id, then control id. Use the framework definition's order
  // to drive section breaks so the binder reads top-to-bottom by function.
  const byCategoryId = new Map<string, BinderControlData[]>();
  for (const c of controls) {
    const arr = byCategoryId.get(c.category_id) ?? [];
    arr.push(c);
    byCategoryId.set(c.category_id, arr);
  }
  for (const arr of byCategoryId.values()) arr.sort((a, b) => a.control_id.localeCompare(b.control_id));

  return (
    <Document
      title={`${tenant.display_name} — Audit Binder`}
      author={tenant.display_name}
      subject="Audit Evidence Binder"
      creator="TrustOS"
    >
      {/* ====================== Cover page ====================== */}
      <Page size="LETTER" style={baseStyles.page}>
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · Audit Binder</Text>
        </View>
        <View style={baseStyles.pageFooter} fixed>
          <Text>As of {fmtDate(asOf.toISOString())}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        <View style={[baseStyles.cover, { borderBottomColor: palette.primary }]}>
          <Text style={[baseStyles.coverEyebrow, { color: palette.primary }]}>
            Audit Binder
          </Text>
          <Text style={baseStyles.coverTitle}>
            {frameworkName} · Evidence + Control Coverage
          </Text>
          <Text style={[baseStyles.coverSub, { marginTop: 6 }]}>
            Prepared for: External auditor · Compliance Lead · Executive Sponsor
          </Text>

          <View style={[baseStyles.metaGrid, { marginTop: 18 }]}>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Controls in Framework</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {total}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Practice Scored</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {scored} / {total}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                Overall avg: {fmtScore(overallPra)}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Controls With Evidence</Text>
              <Text style={[baseStyles.metaVal, {
                fontSize: 18, fontWeight: 700,
                color: withEvidence >= total / 2 ? palette.status.closed : palette.severity.medium,
              }]}>
                {withEvidence} / {total}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Controls With Linked Policy</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {withPolicy} / {total}
              </Text>
            </View>
          </View>
        </View>

        {/* Per-function summary */}
        <Text style={baseStyles.sectionH}>Per-Function Summary</Text>
        <View style={baseStyles.table}>
          <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
            <Text style={[baseStyles.th, { width: '8%' }]}>Fn</Text>
            <Text style={[baseStyles.th, { width: '38%' }]}>Name</Text>
            <Text style={[baseStyles.th, { width: '12%', textAlign: 'right' }]}>Policy</Text>
            <Text style={[baseStyles.th, { width: '12%', textAlign: 'right' }]}>Practice</Text>
            <Text style={[baseStyles.th, { width: '12%', textAlign: 'right' }]}>Goal</Text>
            <Text style={[baseStyles.th, { width: '18%', textAlign: 'right' }]}>Evidence Coverage</Text>
          </View>
          {fnRollup.map((f) => {
            const polAvg = f.polN ? f.polSum / f.polN : null;
            const praAvg = f.praN ? f.praSum / f.praN : null;
            const golAvg = f.golN ? f.golSum / f.golN : null;
            const accent = GROUP_COLORS[f.id]?.accent ?? palette.primary;
            return (
              <View key={f.id} style={baseStyles.tr} wrap={false}>
                <Text style={[baseStyles.td, { width: '8%', color: accent, fontWeight: 700 }]}>{f.id}</Text>
                <Text style={[baseStyles.td, { width: '38%' }]}>{f.name}</Text>
                <Text style={[baseStyles.td, { width: '12%', textAlign: 'right', color: tierColor(polAvg, palette), fontWeight: 700 }]}>
                  {fmtScore(polAvg)}
                </Text>
                <Text style={[baseStyles.td, { width: '12%', textAlign: 'right', color: tierColor(praAvg, palette), fontWeight: 700 }]}>
                  {fmtScore(praAvg)}
                </Text>
                <Text style={[baseStyles.td, { width: '12%', textAlign: 'right', color: tierColor(golAvg, palette), fontWeight: 700 }]}>
                  {fmtScore(golAvg)}
                </Text>
                <Text style={[baseStyles.td, { width: '18%', textAlign: 'right', color: palette.body }]}>
                  {f.withEv} / {f.total}
                </Text>
              </View>
            );
          })}
        </View>

        <Text style={[baseStyles.para, { fontSize: 9, color: palette.muted, marginTop: 18 }]}>
          This binder walks each control in the {frameworkName} framework. For
          every control it lists the current score (Policy / Practice / Goal),
          the assessment answers on file, and every cross-reference recorded
          in TrustOS — risks the control treats, policies that document it,
          evidence artifacts that prove it, and DR plans / IR playbooks that
          operationalize it. Controls with no score and no linked artifacts
          are reported as &quot;Not yet assessed&quot; so coverage gaps surface
          on a single read.
        </Text>

        <Text style={{ fontSize: 8, color: palette.muted, marginTop: 8 }}>
          Coverage roll-up: {withAnyLink} of {total} controls carry at least
          one cross-reference (evidence / policy / risk / DR / IR).
        </Text>
      </Page>

      {/* ====================== Per-function detail pages ====================== */}
      {definition.groups.map((g) => {
        const accent = GROUP_COLORS[g.id]?.accent ?? palette.primary;
        return (
          <Page key={g.id} size="LETTER" style={baseStyles.page}>
            <View style={baseStyles.pageHeader} fixed>
              <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
              <Text style={baseStyles.pageHeaderType}>Confidential · Audit Binder · {g.id}</Text>
            </View>
            <View style={baseStyles.pageFooter} fixed>
              <Text>As of {fmtDate(asOf.toISOString())}</Text>
              <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
            </View>

            <View style={{ marginBottom: 14, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: accent }}>
              <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 10, color: accent, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                Function {g.id}
              </Text>
              <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 18, color: palette.ink, marginTop: 4 }}>
                {g.name}
              </Text>
            </View>

            {g.categories.map((cat) => {
              const ctrls = byCategoryId.get(cat.id) ?? [];
              return (
                <View key={cat.id} style={{ marginBottom: 8 }} wrap={true}>
                  <View style={{
                    flexDirection: 'row', alignItems: 'baseline',
                    paddingBottom: 4, marginBottom: 6,
                    borderBottomWidth: 0.5, borderBottomColor: palette.rule,
                  }}>
                    <Text style={{
                      fontFamily: 'Helvetica-Bold', fontSize: 9,
                      color: palette.muted, letterSpacing: 1, marginRight: 8,
                    }}>
                      {cat.id}
                    </Text>
                    <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 11, color: palette.ink }}>
                      {cat.name}
                    </Text>
                  </View>

                  {ctrls.map((c) => (
                    <ControlBlock key={c.control_id} control={c} palette={palette} accent={accent} />
                  ))}
                </View>
              );
            })}
          </Page>
        );
      })}

      {/* ====================== Signature page ====================== */}
      <Page size="LETTER" style={baseStyles.page}>
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · Audit Binder</Text>
        </View>
        <View style={baseStyles.pageFooter} fixed>
          <Text>As of {fmtDate(asOf.toISOString())}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        <Text style={baseStyles.sectionH}>Attestation</Text>
        <Text style={[baseStyles.para, { color: palette.body }]}>
          The undersigned attest that the control scoring, evidence artifacts,
          and cross-references summarized in this binder accurately reflect
          the state of {tenant.display_name}&apos;s cybersecurity program
          against the {frameworkName} framework as of {fmtDate(asOf.toISOString())}.
        </Text>
        <Text style={[baseStyles.para, { color: palette.muted, fontSize: 9 }]}>
          Source data lives in TrustOS. Evidence artifacts are stored in
          tenant-private storage; signed download URLs are issued on demand
          to authorized auditors via the Evidence Library.
        </Text>

        <View style={[baseStyles.signBlock, { marginTop: 60 }]} wrap={false}>
          <View style={baseStyles.signCol}>
            <View style={baseStyles.signLine} />
            <Text style={baseStyles.signLabel}>Engagement Lead (USI)</Text>
          </View>
          <View style={baseStyles.signCol}>
            <View style={baseStyles.signLine} />
            <Text style={baseStyles.signLabel}>Tenant Sponsor / CIO</Text>
          </View>
          <View style={baseStyles.signCol}>
            <View style={baseStyles.signLine} />
            <Text style={baseStyles.signLabel}>External Auditor</Text>
          </View>
        </View>
        <View style={[baseStyles.signBlock, { marginTop: 48 }]} wrap={false}>
          <View style={baseStyles.signCol}>
            <View style={baseStyles.signLine} />
            <Text style={baseStyles.signLabel}>Date</Text>
          </View>
          <View style={baseStyles.signCol}>
            <View style={baseStyles.signLine} />
            <Text style={baseStyles.signLabel}>Date</Text>
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

// =============================================================================
// Single-control block — kept compact so multiple fit on a page. Wraps if
// the linked-item tables push past page-bottom.
// =============================================================================

function ControlBlock({
  control, palette, accent,
}: {
  control: BinderControlData;
  palette: ReturnType<typeof paletteFor>;
  accent: string;
}) {
  const pol = control.score?.pol ?? null;
  const pra = control.score?.pra ?? null;
  const gol = control.score?.gol ?? null;

  const hasAnything =
    pol != null || pra != null || gol != null ||
    !!control.assessment?.q1_documented ||
    control.risks.length > 0 || control.policies.length > 0 ||
    control.evidence.length > 0 || control.dr_plans.length > 0 ||
    control.ir_playbooks.length > 0;

  return (
    <View
      style={{
        marginBottom: 10, paddingBottom: 6, paddingLeft: 10,
        borderLeftWidth: 2, borderLeftColor: accent,
      }}
      wrap={false}
    >
      {/* Header row: control id + outcome */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 3 }}>
        <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9, color: accent, width: 56 }}>
          {control.control_id}
        </Text>
        <Text style={{ fontSize: 9, color: palette.ink, flex: 1 }}>
          {control.outcome}
        </Text>
      </View>

      {!hasAnything ? (
        <Text style={{ fontSize: 8, color: palette.muted, fontStyle: 'italic', marginLeft: 56 }}>
          Not yet assessed · no linked artifacts.
        </Text>
      ) : (
        <View style={{ marginLeft: 56 }}>
          {/* Score line */}
          {(pol != null || pra != null || gol != null) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
              <Text style={{ fontSize: 8, color: palette.muted, width: 60 }}>Score</Text>
              <ScorePill label="Pol" value={pol} palette={palette} />
              <ScorePill label="Pra" value={pra} palette={palette} />
              <ScorePill label="Goal" value={gol} palette={palette} />
              {control.score?.owner && (
                <Text style={{ fontSize: 8, color: palette.muted, marginLeft: 8 }}>
                  Owner: {control.score.owner}
                </Text>
              )}
              {control.score?.status && (
                <Text style={{ fontSize: 8, color: palette.muted, marginLeft: 8 }}>
                  Status: {control.score.status}
                </Text>
              )}
            </View>
          )}

          {/* Assessment answers if present */}
          {control.assessment && (control.assessment.q1_documented || control.assessment.q2_followed || control.assessment.q3_measured) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
              <Text style={{ fontSize: 8, color: palette.muted, width: 60 }}>Assessment</Text>
              <AnswerPill label="Q1" value={control.assessment.q1_documented} palette={palette} />
              <AnswerPill label="Q2" value={control.assessment.q2_followed} palette={palette} />
              <AnswerPill label="Q3" value={control.assessment.q3_measured} palette={palette} />
              {control.assessment.q4_improvement && (
                <Text style={{ fontSize: 7.5, color: palette.body, marginLeft: 8, flex: 1, fontStyle: 'italic' }}>
                  &quot;{control.assessment.q4_improvement.slice(0, 120)}
                  {control.assessment.q4_improvement.length > 120 ? '…' : ''}&quot;
                </Text>
              )}
            </View>
          )}

          {/* Notes if any */}
          {control.score?.notes && (
            <View style={{ flexDirection: 'row', marginBottom: 3 }}>
              <Text style={{ fontSize: 8, color: palette.muted, width: 60 }}>Notes</Text>
              <Text style={{ fontSize: 8, color: palette.body, flex: 1 }}>
                {control.score.notes.length > 200 ? control.score.notes.slice(0, 200) + '…' : control.score.notes}
              </Text>
            </View>
          )}

          {/* Linked items — each non-empty list gets a row */}
          {control.evidence.length > 0 && (
            <LinkedRow label="Evidence" palette={palette}>
              {control.evidence.map((e, i) => (
                <Text key={i} style={{ fontSize: 8, color: palette.body }}>
                  • {e.title}
                  {e.collected_date ? ` (${e.collected_date})` : ''}
                  {e.filename ? ` — ${e.filename}` : ''}
                  {e.status !== 'current' ? ` [${e.status}]` : ''}
                </Text>
              ))}
            </LinkedRow>
          )}

          {control.policies.length > 0 && (
            <LinkedRow label="Policies" palette={palette}>
              {control.policies.map((p, i) => (
                <Text key={i} style={{ fontSize: 8, color: palette.body }}>
                  • {p.title}{p.version ? ` v${p.version}` : ''}
                  {p.effective_date ? ` — effective ${p.effective_date}` : ''}
                  {p.status !== 'published' ? ` [${p.status}]` : ''}
                </Text>
              ))}
            </LinkedRow>
          )}

          {control.risks.length > 0 && (
            <LinkedRow label="Risks" palette={palette}>
              {control.risks.map((r, i) => (
                <Text key={i} style={{ fontSize: 8, color: palette.body }}>
                  • <Text style={{ color: residualBand(r.residual_score, palette), fontWeight: 700 }}>{r.code}</Text>
                  {' '}— {r.title} (residual {r.residual_score})
                </Text>
              ))}
            </LinkedRow>
          )}

          {control.dr_plans.length > 0 && (
            <LinkedRow label="DR Plans" palette={palette}>
              {control.dr_plans.map((d, i) => (
                <Text key={i} style={{ fontSize: 8, color: palette.body }}>
                  • [Tier {d.tier}] {d.name}
                  {d.last_tested ? ` — last tested ${d.last_tested}` : ''}
                  {d.last_test_result ? ` (${d.last_test_result})` : ''}
                </Text>
              ))}
            </LinkedRow>
          )}

          {control.ir_playbooks.length > 0 && (
            <LinkedRow label="IR Playbooks" palette={palette}>
              {control.ir_playbooks.map((p, i) => (
                <Text key={i} style={{ fontSize: 8, color: palette.body }}>
                  • [{p.category}] {p.name}
                  {p.last_reviewed ? ` — reviewed ${p.last_reviewed}` : ''}
                </Text>
              ))}
            </LinkedRow>
          )}

          {control.incident_count > 0 && (
            <View style={{ flexDirection: 'row', marginBottom: 2 }}>
              <Text style={{ fontSize: 8, color: palette.muted, width: 60 }}>Incidents</Text>
              <Text style={{ fontSize: 8, color: palette.body }}>
                {control.incident_count} incident{control.incident_count === 1 ? '' : 's'} link this control as a gap.
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function ScorePill({ label, value, palette }: { label: string; value: number | null; palette: ReturnType<typeof paletteFor> }) {
  const color = tierColor(value, palette);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 10 }}>
      <Text style={{ fontSize: 7.5, color: palette.muted, marginRight: 3 }}>{label}</Text>
      <Text style={{ fontSize: 8.5, color, fontWeight: 700 }}>
        {fmtScore(value)}
      </Text>
      {value != null && (
        <Text style={{ fontSize: 7, color: palette.muted, marginLeft: 3 }}>
          ({bandLabel(value)})
        </Text>
      )}
    </View>
  );
}

function AnswerPill({ label, value, palette }: { label: string; value: string | null; palette: ReturnType<typeof paletteFor> }) {
  const color = value === 'yes' ? palette.status.closed
    : value === 'partial' ? palette.severity.medium
    : value === 'no' ? palette.severity.high
    : palette.muted;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 10 }}>
      <Text style={{ fontSize: 7.5, color: palette.muted, marginRight: 3 }}>{label}</Text>
      <Text style={{ fontSize: 8.5, color, fontWeight: 700, textTransform: 'capitalize' }}>
        {value ?? '—'}
      </Text>
    </View>
  );
}

function LinkedRow({
  label, palette, children,
}: {
  label: string;
  palette: ReturnType<typeof paletteFor>;
  children: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 2 }}>
      <Text style={{ fontSize: 8, color: palette.muted, width: 60 }}>{label}</Text>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}
