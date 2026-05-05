/* eslint-disable jsx-a11y/alt-text */
import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, fmtDateTime, registerFonts } from './styles';
import { normalizeTimeline } from '@/lib/incidents/timeline';
import type { Incident, IncidentDocument, Tenant } from '@/lib/supabase/types';

/**
 * Executive Incident Report — board-friendly layout that mirrors the
 * Joe-Nemrow-style PDF the customer expects: cover with severity/status
 * pills + key meta, executive summary, timeline, findings, actions,
 * recommendations, linked NIST CSF controls, attached documents,
 * signature block. Designed to print cleanly on US Letter at 100%.
 */

registerFonts();

export function IncidentReport({
  tenant,
  incident,
  documents,
  preparedBy,
}: {
  tenant: Tenant;
  incident: Incident;
  documents: IncidentDocument[];
  preparedBy: string;
}) {
  const palette = paletteFor(tenant);
  const generated = new Date();
  // Normalize timeline so legacy entries with date prefixes baked into the
  // event text still display correctly — extracts "5/4/2026, 5:12 PM (MT)"
  // out of "…— Spoofed email…" into the When column.
  const timeline = normalizeTimeline(incident.timeline);

  return (
    <Document
      title={`Incident Report — ${incident.title}`}
      author={preparedBy}
      subject="Executive Incident Briefing"
      creator="Cyber Attainment Worksheet"
    >
      <Page size="LETTER" style={baseStyles.page}>
        {/* Header (every page) */}
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · Executive Incident Report</Text>
        </View>

        {/* Footer (every page) */}
        <View style={baseStyles.pageFooter} fixed>
          <Text>Prepared {fmtDate(generated.toISOString())} · {preparedBy}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        {/* Cover */}
        <View style={[baseStyles.cover, { borderBottomColor: palette.primary }]}>
          <Text style={[baseStyles.coverEyebrow, { color: palette.primary }]}>
            Executive Incident Report
          </Text>
          <Text style={baseStyles.coverTitle}>{incident.title}</Text>
          {incident.description && (
            <Text style={[baseStyles.coverSub, { marginTop: 6 }]}>
              Prepared for: Chief Executive Officer · Chief Financial Officer · Board Members
            </Text>
          )}

          <View style={[baseStyles.metaGrid, { marginTop: 18 }]}>
            <MetaItem label="Severity">
              <Pill color={palette.severity[incident.severity]}>{incident.severity}</Pill>
            </MetaItem>
            <MetaItem label="Status">
              <Pill color={palette.status[incident.status]}>{incident.status}</Pill>
            </MetaItem>
            <MetaItem label="Category" value={incident.category ?? '—'} />
            <MetaItem label="Reported by" value={incident.reported_by ?? '—'} />
            <MetaItem label="Detected" value={fmtDateTime(incident.detected_at)} />
            <MetaItem label="Contained" value={fmtDateTime(incident.contained_at)} />
            <MetaItem label="Closed" value={fmtDateTime(incident.closed_at)} />
            <MetaItem label="Affected accounts"
              value={incident.affected_users.length ? incident.affected_users.join(', ') : '—'} />
          </View>
        </View>

        {/* Executive Summary */}
        {incident.description && (
          <View style={baseStyles.sectionBody}>
            <Text style={baseStyles.sectionH}>1. Executive Summary</Text>
            <Text style={baseStyles.para}>{incident.description}</Text>
          </View>
        )}

        {/* Timeline */}
        {timeline.length > 0 && (
          <View style={baseStyles.sectionBody}>
            <Text style={baseStyles.sectionH}>2. Timeline of Events</Text>
            <View style={baseStyles.table}>
              <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
                <Text style={[baseStyles.th, { width: '32%' }]}>When</Text>
                <Text style={[baseStyles.th, { width: '68%' }]}>Event</Text>
              </View>
              {timeline.map((entry, i) => (
                <View key={i} style={baseStyles.tr} wrap={false}>
                  <Text style={[baseStyles.tdMono, { width: '32%' }]}>{entry.at || '—'}</Text>
                  <Text style={[baseStyles.td, { width: '68%' }]}>{entry.event}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Findings */}
        {incident.findings.length > 0 && (
          <View style={baseStyles.sectionBody}>
            <Text style={baseStyles.sectionH}>3. Key Findings</Text>
            <BulletList items={incident.findings} />
          </View>
        )}

        {/* Containment + Remediation Actions */}
        {incident.actions.length > 0 && (
          <View style={baseStyles.sectionBody}>
            <Text style={baseStyles.sectionH}>4. Containment &amp; Remediation Actions</Text>
            <BulletList items={incident.actions} />
          </View>
        )}

        {/* Recommendations */}
        {incident.recommendations.length > 0 && (
          <View style={baseStyles.sectionBody}>
            <Text style={baseStyles.sectionH}>5. Recommendations</Text>
            <BulletList items={incident.recommendations} />
          </View>
        )}

        {/* Linked NIST CSF controls — useful for the board to see which
            controls failed / where future investment goes. */}
        {incident.linked_control_ids.length > 0 && (
          <View style={baseStyles.sectionBody}>
            <Text style={baseStyles.sectionH}>6. Linked NIST CSF 2.0 Controls</Text>
            <Text style={[baseStyles.para, { color: palette.muted, fontSize: 9 }]}>
              Controls this incident exposed as gaps. Each is now a target for measured
              practice improvement in the next quarterly attainment review.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
              {incident.linked_control_ids.map((cid) => (
                <View key={cid} style={{
                  paddingTop: 3, paddingBottom: 3, paddingLeft: 8, paddingRight: 8,
                  marginRight: 6, marginBottom: 6,
                  backgroundColor: palette.bgMute,
                  borderWidth: 0.5, borderColor: palette.rule,
                  borderRadius: 3,
                }}>
                  <Text style={{ fontSize: 9, color: palette.ink, fontWeight: 600 }}>{cid}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Attached docs */}
        {documents.length > 0 && (
          <View style={baseStyles.sectionBody}>
            <Text style={baseStyles.sectionH}>7. Attached Documents</Text>
            <View style={baseStyles.table}>
              <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
                <Text style={[baseStyles.th, { width: '60%' }]}>Filename</Text>
                <Text style={[baseStyles.th, { width: '20%' }]}>Type</Text>
                <Text style={[baseStyles.th, { width: '20%', textAlign: 'right' }]}>Size</Text>
              </View>
              {documents.map((d) => (
                <View key={d.id} style={baseStyles.tr} wrap={false}>
                  <Text style={[baseStyles.td, { width: '60%' }]}>{d.filename}</Text>
                  <Text style={[baseStyles.tdMono, { width: '20%' }]}>{d.content_type ?? '—'}</Text>
                  <Text style={[baseStyles.tdNum, { width: '20%' }]}>
                    {d.size_bytes != null ? formatBytes(d.size_bytes) : '—'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Approval block */}
        <View style={baseStyles.signBlock} wrap={false}>
          <View style={baseStyles.signCol}>
            <View style={baseStyles.signLine} />
            <Text style={baseStyles.signLabel}>Chief Information Officer</Text>
          </View>
          <View style={baseStyles.signCol}>
            <View style={baseStyles.signLine} />
            <Text style={baseStyles.signLabel}>Chief Financial Officer</Text>
          </View>
          <View style={baseStyles.signCol}>
            <View style={baseStyles.signLine} />
            <Text style={baseStyles.signLabel}>Chief Executive Officer</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

function MetaItem({
  label, value, children,
}: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <View style={baseStyles.metaItem}>
      <Text style={baseStyles.metaLabel}>{label}</Text>
      {children ?? <Text style={baseStyles.metaVal}>{value ?? '—'}</Text>}
    </View>
  );
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <View style={{
      paddingTop: 3, paddingBottom: 3, paddingLeft: 10, paddingRight: 10,
      backgroundColor: color + '22',
      borderWidth: 0.5, borderColor: color,
      borderRadius: 999, alignSelf: 'flex-start',
    }}>
      <Text style={{
        fontSize: 9, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: 0.6,
      }}>
        {children}
      </Text>
    </View>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <View>
      {items.map((it, i) => (
        <View key={i} style={baseStyles.bullet} wrap={false}>
          <Text style={baseStyles.bulletDot}>•</Text>
          <Text style={baseStyles.bulletBody}>{it}</Text>
        </View>
      ))}
    </View>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
