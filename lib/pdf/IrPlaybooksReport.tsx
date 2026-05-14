import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, registerFonts } from './styles';
import type { Tenant } from '@/lib/supabase/types';

/**
 * Incident Response Playbook Binder — the document the IR team grabs
 * when a real event hits. One page (or contiguous pages) per active
 * playbook, organized by NIST SP 800-61 response phases (containment,
 * eradication, recovery) plus the operational artifacts an IC needs in
 * the first 60 minutes: detection sources, communications matrix,
 * escalation contacts with phone numbers, evidence-preservation list,
 * regulatory-notification clocks.
 *
 * Cover summarizes the portfolio:
 *   - Total active playbooks
 *   - Playbooks by category (BEC / ransomware / phishing / etc.)
 *   - Review staleness (next_review_due in the past)
 *   - Tabletop history (count with last_tabletop set)
 */

registerFonts();

export interface IrPlaybookRow {
  id: string;
  name: string;
  category: string;
  severity_default: string;
  description: string | null;
  trigger_conditions: string | null;
  detection_sources: string[];
  containment_steps: string[];
  eradication_steps: string[];
  recovery_steps: string[];
  communications_plan: {
    audience?: string;
    when?: string;
    channel?: string;
    message_template?: string;
  }[];
  escalation_contacts: {
    role?: string;
    name?: string;
    phone?: string;
    email?: string;
    when_to_contact?: string;
  }[];
  evidence_to_preserve: string[];
  regulatory_notifications: {
    regulation?: string;
    deadline_hours?: number;
    contact?: string;
    trigger?: string;
  }[];
  linked_control_ids: string[];
  last_reviewed: string | null;
  last_tabletop: string | null;
  next_review_due: string | null;
  status: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  bec:           'Business Email Compromise',
  ransomware:    'Ransomware',
  phishing:      'Phishing',
  malware:       'Malware',
  lost_device:   'Lost / Stolen Device',
  data_breach:   'Data Breach',
  ddos:          'DDoS',
  insider:       'Insider Threat',
  supply_chain:  'Supply-Chain Compromise',
  physical:      'Physical Security',
  other:         'Other',
};

function sevColor(s: string, palette: ReturnType<typeof paletteFor>): string {
  if (s === 'critical') return palette.severity.critical;
  if (s === 'high')     return palette.severity.high;
  if (s === 'medium')   return palette.severity.medium;
  return palette.muted;
}

function fmtDeadline(hours: number | undefined): string {
  if (hours == null) return '—';
  if (hours === 0)   return 'Immediate';
  if (hours < 24)    return `${hours}h`;
  if (hours < 168)   return `${Math.round(hours / 24)}d`;
  return `${Math.round(hours / 24 / 7)}wk`;
}

export function IrPlaybooksReport({
  tenant, playbooks, asOf,
}: {
  tenant: Tenant;
  playbooks: IrPlaybookRow[];
  asOf: Date;
}) {
  const palette = paletteFor(tenant);
  const todayMs = asOf.getTime();

  const active = playbooks.filter((p) => p.status === 'active');
  const total = active.length;
  const reviewed = active.filter((p) => p.last_reviewed).length;
  const tabletopped = active.filter((p) => p.last_tabletop).length;
  const stale = active.filter((p) => p.next_review_due && new Date(p.next_review_due).getTime() < todayMs).length;

  const byCategory: Record<string, number> = {};
  for (const p of active) byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
  const categoryRows = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  const sorted = [...active].sort((a, b) =>
    a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );

  return (
    <Document
      title={`${tenant.display_name} — IR Playbook Binder`}
      author={tenant.display_name}
      subject="Incident Response Playbook Binder"
      creator="TrustOS"
    >
      {/* ====================== Cover ====================== */}
      <Page size="LETTER" style={baseStyles.page}>
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · IR Playbook Binder</Text>
        </View>
        <View style={baseStyles.pageFooter} fixed>
          <Text>As of {fmtDate(asOf.toISOString())}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        <View style={[baseStyles.cover, { borderBottomColor: palette.primary }]}>
          <Text style={[baseStyles.coverEyebrow, { color: palette.primary }]}>
            Incident Response Playbooks
          </Text>
          <Text style={baseStyles.coverTitle}>
            Containment · Eradication · Recovery · Comms · Reg Clocks
          </Text>
          <Text style={[baseStyles.coverSub, { marginTop: 6 }]}>
            Prepared for: Incident Commander · CIO · External Auditor
          </Text>

          <View style={[baseStyles.metaGrid, { marginTop: 18 }]}>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Active Playbooks</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {total}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                across {categoryRows.length} categor{categoryRows.length === 1 ? 'y' : 'ies'}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Reviewed</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {reviewed} / {total}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                have a review date on file
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Tabletop-tested</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {tabletopped} / {total}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Review Overdue</Text>
              <Text style={[baseStyles.metaVal, {
                fontSize: 18, fontWeight: 700,
                color: stale > 0 ? palette.severity.high : palette.status.closed,
              }]}>
                {stale}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                {stale > 0 ? 'past next-review date' : 'all current'}
              </Text>
            </View>
          </View>
        </View>

        {/* Categories table */}
        <Text style={baseStyles.sectionH}>Playbooks Index</Text>
        <View style={baseStyles.table}>
          <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
            <Text style={[baseStyles.th, { width: '20%' }]}>Category</Text>
            <Text style={[baseStyles.th, { width: '46%' }]}>Name</Text>
            <Text style={[baseStyles.th, { width: '12%' }]}>Severity</Text>
            <Text style={[baseStyles.th, { width: '11%' }]}>Reviewed</Text>
            <Text style={[baseStyles.th, { width: '11%' }]}>Next due</Text>
          </View>
          {sorted.map((p) => {
            const od = p.next_review_due && new Date(p.next_review_due).getTime() < todayMs;
            return (
              <View key={p.id} style={baseStyles.tr} wrap={false}>
                <Text style={[baseStyles.td, { width: '20%', color: palette.muted, textTransform: 'uppercase', fontSize: 9 }]}>
                  {CATEGORY_LABEL[p.category] ?? p.category}
                </Text>
                <Text style={[baseStyles.td, { width: '46%', fontWeight: 700 }]}>{p.name}</Text>
                <Text style={[baseStyles.td, {
                  width: '12%',
                  color: sevColor(p.severity_default, palette),
                  fontWeight: 700,
                  textTransform: 'capitalize',
                }]}>
                  {p.severity_default}
                </Text>
                <Text style={[baseStyles.tdMono, { width: '11%' }]}>{p.last_reviewed ?? '—'}</Text>
                <Text style={[baseStyles.tdMono, {
                  width: '11%',
                  color: od ? palette.severity.high : palette.body,
                  fontWeight: od ? 700 : 400,
                }]}>
                  {p.next_review_due ?? '—'}{od ? ' !' : ''}
                </Text>
              </View>
            );
          })}
        </View>
      </Page>

      {/* ====================== One section per playbook ====================== */}
      {sorted.map((p) => {
        const accent = sevColor(p.severity_default, palette);
        return (
          <Page key={p.id} size="LETTER" style={baseStyles.page}>
            <View style={baseStyles.pageHeader} fixed>
              <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
              <Text style={baseStyles.pageHeaderType}>
                Confidential · IR · {CATEGORY_LABEL[p.category] ?? p.category}
              </Text>
            </View>
            <View style={baseStyles.pageFooter} fixed>
              <Text>As of {fmtDate(asOf.toISOString())}</Text>
              <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
            </View>

            <View style={{ marginBottom: 14, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: accent }}>
              <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9, color: accent, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                {CATEGORY_LABEL[p.category] ?? p.category} · default severity {p.severity_default}
              </Text>
              <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 18, color: palette.ink, marginTop: 4 }}>
                {p.name}
              </Text>
            </View>

            {p.description && (
              <View style={{ marginBottom: 10 }}>
                <Text style={[baseStyles.metaLabel, { marginBottom: 4 }]}>Description</Text>
                <Text style={[baseStyles.para, { fontSize: 10, color: palette.body }]}>{p.description}</Text>
              </View>
            )}

            {p.trigger_conditions && (
              <View style={{ marginBottom: 10 }}>
                <Text style={[baseStyles.metaLabel, { marginBottom: 4 }]}>Trigger Conditions</Text>
                <Text style={[baseStyles.para, { fontSize: 10, color: palette.body }]}>
                  {p.trigger_conditions}
                </Text>
              </View>
            )}

            {p.detection_sources.length > 0 && (
              <View style={{ marginBottom: 10 }}>
                <Text style={[baseStyles.metaLabel, { marginBottom: 4 }]}>Detection Sources</Text>
                <Text style={{ fontSize: 9, color: palette.body, lineHeight: 1.5 }}>
                  {p.detection_sources.join(' · ')}
                </Text>
              </View>
            )}

            <PhaseList label="1. Containment" steps={p.containment_steps} palette={palette} accent={accent} />
            <PhaseList label="2. Eradication" steps={p.eradication_steps} palette={palette} accent={accent} />
            <PhaseList label="3. Recovery"    steps={p.recovery_steps}    palette={palette} accent={accent} />

            {/* Communications plan */}
            {p.communications_plan.length > 0 && (
              <View style={{ marginBottom: 12 }} wrap={true}>
                <Text style={baseStyles.sectionH}>Communications Plan</Text>
                <View style={baseStyles.table}>
                  <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
                    <Text style={[baseStyles.th, { width: '20%' }]}>Audience</Text>
                    <Text style={[baseStyles.th, { width: '22%' }]}>When</Text>
                    <Text style={[baseStyles.th, { width: '20%' }]}>Channel</Text>
                    <Text style={[baseStyles.th, { width: '38%' }]}>Message Template</Text>
                  </View>
                  {p.communications_plan.map((c, i) => (
                    <View key={i} style={baseStyles.tr} wrap={false}>
                      <Text style={[baseStyles.td, { width: '20%' }]}>{c.audience ?? '—'}</Text>
                      <Text style={[baseStyles.td, { width: '22%' }]}>{c.when ?? '—'}</Text>
                      <Text style={[baseStyles.td, { width: '20%' }]}>{c.channel ?? '—'}</Text>
                      <Text style={[baseStyles.td, { width: '38%', fontSize: 8.5, fontStyle: 'italic' }]}>
                        {c.message_template ?? '—'}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Escalation contacts */}
            {p.escalation_contacts.length > 0 && (
              <View style={{ marginBottom: 12 }} wrap={true}>
                <Text style={baseStyles.sectionH}>Escalation Contacts</Text>
                <View style={baseStyles.table}>
                  <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
                    <Text style={[baseStyles.th, { width: '22%' }]}>Role</Text>
                    <Text style={[baseStyles.th, { width: '18%' }]}>Name</Text>
                    <Text style={[baseStyles.th, { width: '16%' }]}>Phone</Text>
                    <Text style={[baseStyles.th, { width: '20%' }]}>Email</Text>
                    <Text style={[baseStyles.th, { width: '24%' }]}>When to contact</Text>
                  </View>
                  {p.escalation_contacts.map((c, i) => (
                    <View key={i} style={baseStyles.tr} wrap={false}>
                      <Text style={[baseStyles.td, { width: '22%', fontWeight: 700 }]}>{c.role ?? '—'}</Text>
                      <Text style={[baseStyles.td, { width: '18%' }]}>{c.name || '—'}</Text>
                      <Text style={[baseStyles.tdMono, { width: '16%' }]}>{c.phone || '—'}</Text>
                      <Text style={[baseStyles.tdMono, { width: '20%' }]}>{c.email || '—'}</Text>
                      <Text style={[baseStyles.td, { width: '24%', fontSize: 8.5 }]}>{c.when_to_contact ?? '—'}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Evidence to preserve */}
            {p.evidence_to_preserve.length > 0 && (
              <View style={{ marginBottom: 12 }} wrap={true}>
                <Text style={baseStyles.sectionH}>Evidence to Preserve</Text>
                {p.evidence_to_preserve.map((e, i) => (
                  <Text key={i} style={{ fontSize: 9, color: palette.body, marginBottom: 2 }}>
                    • {e}
                  </Text>
                ))}
              </View>
            )}

            {/* Regulatory notifications */}
            {p.regulatory_notifications.length > 0 && (
              <View style={{ marginBottom: 12 }} wrap={true}>
                <Text style={baseStyles.sectionH}>Regulatory Notifications</Text>
                <View style={baseStyles.table}>
                  <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
                    <Text style={[baseStyles.th, { width: '28%' }]}>Regulation</Text>
                    <Text style={[baseStyles.th, { width: '12%' }]}>Deadline</Text>
                    <Text style={[baseStyles.th, { width: '28%' }]}>Contact</Text>
                    <Text style={[baseStyles.th, { width: '32%' }]}>Trigger</Text>
                  </View>
                  {p.regulatory_notifications.map((r, i) => {
                    const urgent = (r.deadline_hours ?? 999) <= 72;
                    return (
                      <View key={i} style={baseStyles.tr} wrap={false}>
                        <Text style={[baseStyles.td, { width: '28%', fontWeight: 700 }]}>
                          {r.regulation ?? '—'}
                        </Text>
                        <Text style={[baseStyles.tdMono, {
                          width: '12%',
                          color: urgent ? palette.severity.high : palette.body,
                          fontWeight: 700,
                        }]}>
                          {fmtDeadline(r.deadline_hours)}
                        </Text>
                        <Text style={[baseStyles.td, { width: '28%', fontSize: 8.5 }]}>
                          {r.contact ?? '—'}
                        </Text>
                        <Text style={[baseStyles.td, { width: '32%', fontSize: 8.5 }]}>
                          {r.trigger ?? '—'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Review cadence + linked controls footer */}
            <View style={{
              marginTop: 12, paddingTop: 8,
              borderTopWidth: 0.5, borderTopColor: palette.rule,
              flexDirection: 'row', justifyContent: 'space-between',
            }}>
              <View>
                <Text style={{ fontSize: 8, color: palette.muted }}>
                  Last reviewed: {p.last_reviewed ?? '—'} · Last tabletop: {p.last_tabletop ?? '—'} · Next review due: {p.next_review_due ?? '—'}
                </Text>
                {p.linked_control_ids.length > 0 && (
                  <Text style={{ fontSize: 8, color: palette.muted, marginTop: 2 }}>
                    NIST CSF controls: {p.linked_control_ids.join(', ')}
                  </Text>
                )}
              </View>
            </View>
          </Page>
        );
      })}
    </Document>
  );
}

function PhaseList({
  label, steps, palette, accent,
}: {
  label: string;
  steps: string[];
  palette: ReturnType<typeof paletteFor>;
  accent: string;
}) {
  if (steps.length === 0) return null;
  return (
    <View style={{ marginBottom: 10 }} wrap={true}>
      <Text style={baseStyles.sectionH}>{label}</Text>
      {steps.map((s, i) => (
        <View key={i} style={{ flexDirection: 'row', marginBottom: 3 }} wrap={false}>
          <Text style={{ width: 24, fontSize: 9, color: accent, fontWeight: 700 }}>{i + 1}.</Text>
          <Text style={{ flex: 1, fontSize: 9.5, color: palette.body, lineHeight: 1.5 }}>{s}</Text>
        </View>
      ))}
    </View>
  );
}
