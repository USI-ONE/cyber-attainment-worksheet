/* eslint-disable jsx-a11y/alt-text */
import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, registerFonts } from './styles';
import type {
  AttestationStatus,
  AttestationType,
  AttestationChecklist,
  AttestationChecklistItem,
  EvidenceArtifact,
  Risk,
  Tenant,
  Vendor,
  VendorAttestation,
  VendorCriticality,
  VendorDataSensitivity,
  VendorType,
} from '@/lib/supabase/types';

/**
 * Executive Briefing on a single Vendor Response (attestation / TPSA / DDQ).
 *
 * Built for board-style consumption: one vendor, one attestation, a
 * recommendation, the concerns that matter, and the artifacts on file.
 * Designed to be ~3-6 pages depending on how rich the checklist is.
 *
 * Page layout:
 *   1. Cover with recommendation pill
 *   2. Vendor at a glance + attestation snapshot
 *   3. Response analysis — counts by answer + by section
 *   4. Concerns — every No / Partial / N/A / blank with notes
 *   5. Linked risks + linked evidence on file
 *   6. Recommendation + reviewer signatures
 */

registerFonts();

const ATTESTATION_LABEL: Record<AttestationType, string> = {
  soc2_type1:        'SOC 2 Type I',
  soc2_type2:        'SOC 2 Type II',
  iso_27001:         'ISO 27001',
  iso_27017:         'ISO 27017',
  iso_27018:         'ISO 27018',
  iso_27701:         'ISO 27701',
  pci_dss:           'PCI DSS',
  hipaa_baa:         'HIPAA BAA',
  fedramp_high:      'FedRAMP High',
  fedramp_moderate:  'FedRAMP Moderate',
  cmmc:              'CMMC',
  cyber_insurance:   'Cyber Insurance',
  penetration_test:  'Penetration Test',
  vulnerability_scan: 'Vulnerability Scan',
  tpsa:              'TPSA',
  ddq:               'DDQ',
  other:             'Other',
};

const TYPE_LABEL: Record<VendorType, string> = {
  saas:           'SaaS',
  msp:            'MSP',
  hardware:       'Hardware',
  consulting:     'Consulting',
  payments:       'Payments',
  infrastructure: 'Infrastructure',
  contractor:     'Contractor',
  other:          'Other',
};

const CRIT_LABEL: Record<VendorCriticality, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
};
const CRIT_COLOR: Record<VendorCriticality, string> = {
  low: '#64748B', medium: '#F59E0B', high: '#DC2626', critical: '#991B1B',
};

const SENS_LABEL: Record<VendorDataSensitivity, string> = {
  none: 'No data', public: 'Public', internal: 'Internal',
  confidential: 'Confidential', pii: 'PII', phi: 'PHI',
  financial: 'Financial', regulated: 'Regulated',
};

const ATT_STATUS_COLOR: Record<AttestationStatus, string> = {
  pending: '#F59E0B', current: '#10B981', expired: '#DC2626',
  superseded: '#94A3B8', archived: '#64748B',
};

// =============================================================================
// Helpers — checklist analysis
// =============================================================================

type AnswerKind = 'yes' | 'no' | 'partial' | 'na' | 'unanswered';

function classifyResponse(it: AttestationChecklistItem): AnswerKind {
  const r = (it.response ?? '').toString().trim().toLowerCase();
  if (!r || r === 'unanswered' || r === 'blank') return 'unanswered';
  if (r === 'yes') return 'yes';
  if (r === 'no') return 'no';
  if (r === 'partial') return 'partial';
  if (r === 'na' || r === 'n/a') return 'na';
  // anything else (e.g. 'unknown') we treat as unanswered for analytics
  return 'unanswered';
}

function sectionOf(itemId: string): string {
  // For checklist ids like "4.1", "5.2.scope_blank" return the section
  // number ("4", "5") to group rows. Falls back to "Other".
  const m = /^(\d+)/.exec(itemId);
  return m ? m[1] : 'Other';
}

interface SectionRollup {
  section: string;
  total: number;
  yes: number; no: number; partial: number; na: number; unanswered: number;
}

function rollupBySection(items: AttestationChecklistItem[]): SectionRollup[] {
  const byId = new Map<string, SectionRollup>();
  for (const it of items) {
    const s = sectionOf(it.id);
    if (!byId.has(s)) byId.set(s, { section: s, total: 0, yes: 0, no: 0, partial: 0, na: 0, unanswered: 0 });
    const row = byId.get(s)!;
    row.total++;
    const k = classifyResponse(it);
    row[k]++;
  }
  return Array.from(byId.values()).sort((a, b) => {
    // Numeric sort by section number when possible
    const an = parseInt(a.section, 10);
    const bn = parseInt(b.section, 10);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.section.localeCompare(b.section);
  });
}

interface OverallRollup {
  total: number;
  yes: number; no: number; partial: number; na: number; unanswered: number;
  concerns: number; // no + partial + unanswered (na is not a concern by itself)
  yesPct: number; concernsPct: number;
}
function rollupAll(items: AttestationChecklistItem[]): OverallRollup {
  const r = { total: 0, yes: 0, no: 0, partial: 0, na: 0, unanswered: 0, concerns: 0, yesPct: 0, concernsPct: 0 };
  for (const it of items) {
    r.total++;
    const k = classifyResponse(it);
    r[k]++;
  }
  r.concerns = r.no + r.partial + r.unanswered;
  r.yesPct = r.total ? Math.round((r.yes / r.total) * 100) : 0;
  r.concernsPct = r.total ? Math.round((r.concerns / r.total) * 100) : 0;
  return r;
}

// Recommendation pill — derived heuristically from the overall response.
// Reviewers can override with the explicit `recommendation` prop.
interface Recommendation {
  status: 'Renew' | 'Conditional Renewal' | 'Defer' | 'Terminate' | 'Subject to Review';
  color: string;
  rationale: string;
}
function deriveRecommendation(overall: OverallRollup, att: VendorAttestation): Recommendation {
  if (att.findings_critical && att.findings_critical > 0) {
    return { status: 'Defer', color: '#991B1B',
      rationale: `${att.findings_critical} critical finding${att.findings_critical === 1 ? '' : 's'} on the attestation.` };
  }
  if (overall.concernsPct >= 40) {
    return { status: 'Conditional Renewal', color: '#DC2626',
      rationale: `${overall.concernsPct}% of responses landed in No / Partial / Unanswered. Conditions needed before renewal.` };
  }
  if (overall.concernsPct >= 20) {
    return { status: 'Conditional Renewal', color: '#F59E0B',
      rationale: `${overall.concernsPct}% of responses are concerns. Targeted treatment recommended.` };
  }
  if (overall.yesPct >= 80) {
    return { status: 'Renew', color: '#10B981',
      rationale: `${overall.yesPct}% of responses returned Yes. No material concerns.` };
  }
  return { status: 'Subject to Review', color: '#64748B',
    rationale: 'No clear signal; manual review recommended.' };
}

// =============================================================================
// Component
// =============================================================================

export interface VendorBriefingProps {
  tenant: Tenant;
  vendor: Vendor;
  attestation: VendorAttestation;
  linkedRisks: Risk[];
  linkedEvidence: EvidenceArtifact[];
  preparedBy?: string;
  /** Explicit reviewer-set recommendation. If absent, the briefing derives
   *  one from the checklist + findings count. */
  recommendationOverride?: Recommendation;
}

export function VendorBriefingReport({
  tenant, vendor, attestation, linkedRisks, linkedEvidence,
  preparedBy, recommendationOverride,
}: VendorBriefingProps) {
  const palette = paletteFor(tenant);

  const checklist: AttestationChecklist | null = attestation.checklist ?? null;
  const items = checklist?.items ?? [];
  const overall = rollupAll(items);
  const sectionRollup = rollupBySection(items);
  const concerns = items
    .filter((it) => {
      const k = classifyResponse(it);
      return k === 'no' || k === 'partial' || k === 'unanswered';
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const naItems = items.filter((it) => classifyResponse(it) === 'na');

  const rec = recommendationOverride ?? deriveRecommendation(overall, attestation);

  const headerEyebrow = `${tenant.display_name.toUpperCase()} • EXECUTIVE BRIEFING`;
  const reportTitle = 'Vendor Response Executive Briefing';
  const reportSubtitle = `${vendor.name} — ${attestation.title || ATTESTATION_LABEL[attestation.attestation_type] || 'Attestation'}`;

  return (
    <Document
      title={`${vendor.name} — Vendor Response Briefing`}
      author={`${tenant.display_name} (SecureOS)`}
      creator="SecureOS"
      subject={reportSubtitle}
    >
      {/* ─────────────────────────── PAGE 1 — Cover ─────────────────────────── */}
      <Page size="LETTER" style={baseStyles.page} wrap>
        <PageHeader tenant={tenant} type="Vendor Briefing" />

        <View style={[baseStyles.cover, { borderBottomColor: palette.primary }]}>
          <Text style={[baseStyles.coverEyebrow, { color: palette.primary }]}>
            {headerEyebrow}
          </Text>
          <Text style={baseStyles.coverTitle}>{reportTitle}</Text>
          <Text style={baseStyles.coverSub}>{reportSubtitle}</Text>

          {/* Recommendation pill */}
          <View style={{ marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={[baseStyles.pill, { backgroundColor: `${rec.color}22`, color: rec.color }]}>
              Recommendation · {rec.status}
            </Text>
          </View>
          <Text style={{ marginTop: 8, fontSize: 10, color: palette.body, fontStyle: 'italic' }}>
            {rec.rationale}
          </Text>

          {/* Meta grid */}
          <View style={baseStyles.metaGrid}>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Vendor</Text>
              <Text style={baseStyles.metaVal}>{vendor.name}</Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Vendor type</Text>
              <Text style={baseStyles.metaVal}>{TYPE_LABEL[vendor.vendor_type] ?? vendor.vendor_type}</Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Criticality</Text>
              <Text style={[baseStyles.metaVal, { color: CRIT_COLOR[vendor.criticality], fontFamily: 'Helvetica-Bold' }]}>
                {CRIT_LABEL[vendor.criticality]}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Data sensitivity</Text>
              <Text style={baseStyles.metaVal}>{SENS_LABEL[vendor.data_sensitivity]}</Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Attestation</Text>
              <Text style={baseStyles.metaVal}>{ATTESTATION_LABEL[attestation.attestation_type] ?? attestation.attestation_type}</Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Attestation status</Text>
              <Text style={[baseStyles.metaVal, { color: ATT_STATUS_COLOR[attestation.status], fontFamily: 'Helvetica-Bold' }]}>
                {attestation.status.toUpperCase()}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Issued / Expires</Text>
              <Text style={baseStyles.metaVal}>
                {fmtDate(attestation.issued_on)} · {fmtDate(attestation.expires_on)}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Briefing prepared</Text>
              <Text style={baseStyles.metaVal}>{fmtDate(new Date().toISOString())}{preparedBy ? ` · ${preparedBy}` : ''}</Text>
            </View>
          </View>
        </View>

        {/* Executive summary panel */}
        <Text style={baseStyles.sectionH}>Executive Summary</Text>
        <View style={[baseStyles.sectionBody, { marginBottom: 12 }]}>
          <SummaryStats overall={overall} attestation={attestation} palette={palette} />
        </View>

        {/* Vendor service description */}
        {vendor.service_description && (
          <>
            <Text style={baseStyles.sectionH}>Vendor Service</Text>
            <Text style={[baseStyles.para, { color: palette.body }]}>{vendor.service_description}</Text>
          </>
        )}

        <PageFooter />
      </Page>

      {/* ─────────────────────── PAGE 2 — Response Analysis ─────────────────── */}
      <Page size="LETTER" style={baseStyles.page} wrap>
        <PageHeader tenant={tenant} type="Vendor Briefing" />

        <Text style={baseStyles.sectionH}>Response Analysis by Section</Text>
        {sectionRollup.length === 0 ? (
          <Text style={[baseStyles.para, { color: palette.muted, fontStyle: 'italic' }]}>
            No checklist returned with this attestation.
          </Text>
        ) : (
          <View style={baseStyles.table}>
            <View style={baseStyles.tr}>
              <Text style={[baseStyles.th, { width: '14%' }]}>Section</Text>
              <Text style={[baseStyles.th, { width: '14%' }]}>Items</Text>
              <Text style={[baseStyles.th, { width: '14%', color: '#065F46' }]}>Yes</Text>
              <Text style={[baseStyles.th, { width: '14%', color: '#9A3412' }]}>Partial</Text>
              <Text style={[baseStyles.th, { width: '14%', color: '#991B1B' }]}>No</Text>
              <Text style={[baseStyles.th, { width: '14%', color: palette.muted }]}>N/A</Text>
              <Text style={[baseStyles.th, { width: '16%', color: '#92400E' }]}>Unanswered</Text>
            </View>
            {sectionRollup.map((s) => (
              <View key={s.section} style={baseStyles.tr}>
                <Text style={[baseStyles.td, { width: '14%', fontFamily: 'Helvetica-Bold' }]}>§ {s.section}</Text>
                <Text style={[baseStyles.tdNum, { width: '14%' }]}>{s.total}</Text>
                <Text style={[baseStyles.tdNum, { width: '14%', color: s.yes ? '#065F46' : palette.muted }]}>{s.yes}</Text>
                <Text style={[baseStyles.tdNum, { width: '14%', color: s.partial ? '#9A3412' : palette.muted }]}>{s.partial}</Text>
                <Text style={[baseStyles.tdNum, { width: '14%', color: s.no ? '#991B1B' : palette.muted, fontFamily: s.no ? 'Helvetica-Bold' : 'Helvetica' }]}>{s.no}</Text>
                <Text style={[baseStyles.tdNum, { width: '14%', color: palette.muted }]}>{s.na}</Text>
                <Text style={[baseStyles.tdNum, { width: '16%', color: s.unanswered ? '#92400E' : palette.muted, fontFamily: s.unanswered ? 'Helvetica-Bold' : 'Helvetica' }]}>{s.unanswered}</Text>
              </View>
            ))}
          </View>
        )}

        {checklist && (
          <Text style={[baseStyles.para, { color: palette.muted, fontSize: 9, marginTop: 4 }]}>
            Template: <Text style={{ fontFamily: 'Helvetica-Bold' }}>{checklist.template_version}</Text>
            {' · '}Items in template: {items.length}
            {naItems.length > 0 && ` · N/A items skipped: ${naItems.length}`}
          </Text>
        )}

        {/* Insurance / findings strip */}
        <Text style={baseStyles.sectionH}>Attestation Snapshot</Text>
        <View style={baseStyles.table}>
          <KVRow label="Title" value={attestation.title || '—'} />
          <KVRow label="Type" value={ATTESTATION_LABEL[attestation.attestation_type] ?? attestation.attestation_type} />
          <KVRow label="Issued on" value={fmtDate(attestation.issued_on)} />
          <KVRow label="Expires on" value={fmtDate(attestation.expires_on)} />
          <KVRow label="Status" value={attestation.status} valueColor={ATT_STATUS_COLOR[attestation.status]} bold />
          <KVRow label="Findings — Critical" value={String(attestation.findings_critical ?? 0)}
            valueColor={(attestation.findings_critical ?? 0) > 0 ? '#991B1B' : palette.muted}
            bold={(attestation.findings_critical ?? 0) > 0} />
          <KVRow label="Findings — Major" value={String(attestation.findings_major ?? 0)}
            valueColor={(attestation.findings_major ?? 0) > 0 ? '#DC2626' : palette.muted} />
          <KVRow label="Findings — Minor" value={String(attestation.findings_minor ?? 0)}
            valueColor={(attestation.findings_minor ?? 0) > 0 ? '#F59E0B' : palette.muted} />
          {attestation.notes && <KVRow label="Notes" value={attestation.notes} />}
        </View>

        <PageFooter />
      </Page>

      {/* ─────────────────────── PAGE 3+ — Concerns ─────────────────────────── */}
      <Page size="LETTER" style={baseStyles.page} wrap>
        <PageHeader tenant={tenant} type="Vendor Briefing" />

        <Text style={baseStyles.sectionH}>Concerns — Every Non-Yes Response</Text>
        {concerns.length === 0 ? (
          <Text style={[baseStyles.para, { color: palette.muted, fontStyle: 'italic' }]}>
            No concerns identified. Every checklist item returned Yes or N/A.
          </Text>
        ) : (
          concerns.map((it) => {
            const k = classifyResponse(it);
            const badgeColor = k === 'no' ? '#991B1B' : k === 'partial' ? '#9A3412' : '#92400E';
            const badgeText  = k === 'no' ? 'NO' : k === 'partial' ? 'PARTIAL' : 'UNANSWERED';
            return (
              <View key={it.id} style={{ marginBottom: 8, paddingBottom: 6, borderBottomWidth: 0.4, borderBottomColor: palette.rule }} wrap={false}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
                  <Text style={[baseStyles.pill, { backgroundColor: `${badgeColor}1a`, color: badgeColor, fontSize: 7 }]}>{badgeText}</Text>
                  <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 10, color: palette.ink, flex: 1 }}>
                    <Text style={{ color: palette.muted }}>{it.id}  </Text>
                    {it.label}
                  </Text>
                </View>
                {it.notes && (
                  <Text style={{ fontSize: 9.5, color: palette.body, marginLeft: 64 }}>
                    {it.notes}
                  </Text>
                )}
              </View>
            );
          })
        )}

        <PageFooter />
      </Page>

      {/* ─────────────────────── PAGE 4 — Linked context + recommendation ─── */}
      <Page size="LETTER" style={baseStyles.page} wrap>
        <PageHeader tenant={tenant} type="Vendor Briefing" />

        <Text style={baseStyles.sectionH}>Linked Risks ({linkedRisks.length})</Text>
        {linkedRisks.length === 0 ? (
          <Text style={[baseStyles.para, { color: palette.muted, fontStyle: 'italic' }]}>
            No risks have been logged against this vendor in the Risk Register.
          </Text>
        ) : (
          <View style={baseStyles.table}>
            <View style={baseStyles.tr}>
              <Text style={[baseStyles.th, { width: '14%' }]}>Code</Text>
              <Text style={[baseStyles.th, { width: '40%' }]}>Title</Text>
              <Text style={[baseStyles.th, { width: '12%' }]}>Strategy</Text>
              <Text style={[baseStyles.th, { width: '12%' }]}>Inherent</Text>
              <Text style={[baseStyles.th, { width: '12%' }]}>Residual</Text>
              <Text style={[baseStyles.th, { width: '10%' }]}>Owner</Text>
            </View>
            {linkedRisks.map((r) => {
              const inh = (r.inherent_likelihood ?? 0) * (r.inherent_impact ?? 0);
              const res = (r.residual_likelihood ?? 0) * (r.residual_impact ?? 0);
              return (
                <View key={r.id} style={baseStyles.tr} wrap={false}>
                  <Text style={[baseStyles.td, { width: '14%', fontFamily: 'Helvetica-Bold' }]}>{r.code ?? '—'}</Text>
                  <Text style={[baseStyles.td, { width: '40%' }]}>{r.title}</Text>
                  <Text style={[baseStyles.td, { width: '12%', textTransform: 'capitalize' }]}>{r.treatment_strategy ?? '—'}</Text>
                  <Text style={[baseStyles.tdNum, { width: '12%' }]}>{inh || '—'}</Text>
                  <Text style={[baseStyles.tdNum, { width: '12%' }]}>{res || '—'}</Text>
                  <Text style={[baseStyles.td, { width: '10%', fontSize: 8.5 }]}>{(r.owner ?? '—').split(' ').slice(0, 2).join(' ')}</Text>
                </View>
              );
            })}
          </View>
        )}

        <Text style={baseStyles.sectionH}>Evidence on File ({linkedEvidence.length})</Text>
        {linkedEvidence.length === 0 ? (
          <Text style={[baseStyles.para, { color: palette.muted, fontStyle: 'italic' }]}>
            No evidence artifacts linked to this vendor in the Evidence Library.
          </Text>
        ) : (
          <View style={baseStyles.table}>
            <View style={baseStyles.tr}>
              <Text style={[baseStyles.th, { width: '50%' }]}>Title</Text>
              <Text style={[baseStyles.th, { width: '20%' }]}>Category</Text>
              <Text style={[baseStyles.th, { width: '15%' }]}>Status</Text>
              <Text style={[baseStyles.th, { width: '15%' }]}>Collected</Text>
            </View>
            {linkedEvidence.map((e) => (
              <View key={e.id} style={baseStyles.tr} wrap={false}>
                <Text style={[baseStyles.td, { width: '50%' }]}>{e.title}</Text>
                <Text style={[baseStyles.td, { width: '20%', fontSize: 9 }]}>{e.category}</Text>
                <Text style={[baseStyles.td, { width: '15%', fontSize: 9 }]}>{e.status}</Text>
                <Text style={[baseStyles.td, { width: '15%', fontSize: 9 }]}>{fmtDate(e.collected_date)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={baseStyles.sectionH}>Recommendation</Text>
        <View style={{ marginBottom: 8 }}>
          <Text style={[baseStyles.pill, { backgroundColor: `${rec.color}22`, color: rec.color, marginBottom: 6 }]}>
            {rec.status.toUpperCase()}
          </Text>
          <Text style={[baseStyles.para, { color: palette.body }]}>{rec.rationale}</Text>
          <Text style={[baseStyles.para, { color: palette.body }]}>
            Reviewer to capture the conditions, owners, and due dates required to act on this recommendation,
            log them as risk treatments in the Risk Register, and obtain executive sign-off below.
          </Text>
        </View>

        {/* Signatures */}
        <View style={baseStyles.signBlock}>
          <View style={baseStyles.signCol}>
            <View style={baseStyles.signLine} />
            <Text style={baseStyles.signLabel}>Information Security Lead</Text>
          </View>
          <View style={baseStyles.signCol}>
            <View style={baseStyles.signLine} />
            <Text style={baseStyles.signLabel}>Vendor Risk Owner</Text>
          </View>
          <View style={baseStyles.signCol}>
            <View style={baseStyles.signLine} />
            <Text style={baseStyles.signLabel}>Executive Sponsor</Text>
          </View>
        </View>

        <PageFooter />
      </Page>
    </Document>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function PageHeader({ tenant, type }: { tenant: Tenant; type: string }) {
  return (
    <View style={baseStyles.pageHeader} fixed>
      <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
      <Text style={baseStyles.pageHeaderType}>{type.toUpperCase()}</Text>
    </View>
  );
}

function PageFooter() {
  return (
    <View style={baseStyles.pageFooter} fixed>
      <Text>Confidential — Vendor Risk Briefing</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function KVRow({ label, value, valueColor, bold }: {
  label: string; value: string; valueColor?: string; bold?: boolean;
}) {
  return (
    <View style={baseStyles.tr} wrap={false}>
      <Text style={[baseStyles.th, { width: '30%' }]}>{label}</Text>
      <Text style={[baseStyles.td, { width: '70%', color: valueColor, fontFamily: bold ? 'Helvetica-Bold' : 'Helvetica' }]}>
        {value}
      </Text>
    </View>
  );
}

function SummaryStats({
  overall, attestation, palette,
}: { overall: OverallRollup; attestation: VendorAttestation; palette: ReturnType<typeof paletteFor> }) {
  if (overall.total === 0) {
    return (
      <Text style={{ fontSize: 10, color: palette.muted, fontStyle: 'italic' }}>
        No checklist was returned with this attestation. Briefing summary is based on the metadata only.
      </Text>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap: 0 }}>
      <StatTile label="Total items"  value={String(overall.total)}            palette={palette} />
      <StatTile label="Yes"          value={String(overall.yes)}              palette={palette} accent="#10B981" />
      <StatTile label="Partial"      value={String(overall.partial)}          palette={palette} accent="#F59E0B" />
      <StatTile label="No"           value={String(overall.no)}               palette={palette} accent="#DC2626" />
      <StatTile label="Unanswered"   value={String(overall.unanswered)}       palette={palette} accent="#92400E" />
      <StatTile label="% Yes"        value={`${overall.yesPct}%`}             palette={palette} />
      <StatTile label="Concerns"     value={`${overall.concernsPct}%`}        palette={palette} accent="#991B1B" />
      <StatTile label="Findings (C/M/m)"
        value={`${attestation.findings_critical ?? 0}/${attestation.findings_major ?? 0}/${attestation.findings_minor ?? 0}`}
        palette={palette} />
    </View>
  );
}

function StatTile({ label, value, palette, accent }: {
  label: string; value: string;
  palette: ReturnType<typeof paletteFor>; accent?: string;
}) {
  return (
    <View style={{
      flex: 1, paddingTop: 8, paddingBottom: 8, paddingLeft: 6, paddingRight: 6,
      borderRightWidth: 0.5, borderRightColor: palette.rule,
    }}>
      <Text style={{
        fontSize: 7, fontFamily: 'Helvetica-Bold', color: palette.muted,
        letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4,
      }}>{label}</Text>
      <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color: accent || palette.ink }}>{value}</Text>
    </View>
  );
}
