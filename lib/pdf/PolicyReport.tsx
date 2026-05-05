import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, registerFonts } from './styles';
import type { PolicyDocument, Tenant } from '@/lib/supabase/types';

/**
 * Executive Policy Coverage Briefing — board-friendly summary of the
 * tenant's uploaded policy artifacts, the controls each one backs, and
 * any controls that lack policy coverage. Useful for the audit trail
 * conversation: "we scored a 4 on PR.AA-05 because the IT Policies
 * doc, v4.24.26, owned by the CIO, says X."
 */

registerFonts();

export function PolicyReport({
  tenant,
  documents,
  totalControlCount,
  asOf,
}: {
  tenant: Tenant;
  documents: PolicyDocument[];
  totalControlCount: number;
  asOf: Date;
}) {
  const palette = paletteFor(tenant);

  // Build the inverse map: control_id -> document titles. Only counts
  // published or draft docs (archived excluded).
  const active = documents.filter((d) => d.status !== 'archived');
  const byControl = new Map<string, string[]>();
  for (const d of active) {
    for (const cid of d.linked_control_ids) {
      const arr = byControl.get(cid) ?? [];
      arr.push(d.title);
      byControl.set(cid, arr);
    }
  }

  return (
    <Document
      title={`${tenant.display_name} — Policy Coverage Briefing`}
      author={tenant.display_name}
      subject="Policy Coverage Executive Briefing"
      creator="Cyber Attainment Worksheet"
    >
      <Page size="LETTER" style={baseStyles.page}>
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · Policy Coverage Briefing</Text>
        </View>
        <View style={baseStyles.pageFooter} fixed>
          <Text>As of {fmtDate(asOf.toISOString())}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        {/* Cover */}
        <View style={[baseStyles.cover, { borderBottomColor: palette.primary }]}>
          <Text style={[baseStyles.coverEyebrow, { color: palette.primary }]}>
            Policy Coverage Briefing
          </Text>
          <Text style={baseStyles.coverTitle}>NIST CSF 2.0 Policy Mapping</Text>
          <Text style={[baseStyles.coverSub, { marginTop: 6 }]}>
            Prepared for: Chief Executive Officer · Chief Financial Officer · Board Members
          </Text>

          <View style={[baseStyles.metaGrid, { marginTop: 18 }]}>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Active Policy Documents</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {active.length}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Controls Backed By Policy</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {byControl.size} of {totalControlCount}
              </Text>
            </View>
          </View>
        </View>

        {/* Documents listing */}
        <Text style={baseStyles.sectionH}>1. Active Policy Documents</Text>
        {active.length === 0 ? (
          <Text style={[baseStyles.para, { color: palette.muted }]}>
            No active policy documents on file.
          </Text>
        ) : (
          <View style={baseStyles.table}>
            <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
              <Text style={[baseStyles.th, { width: '38%' }]}>Title</Text>
              <Text style={[baseStyles.th, { width: '14%' }]}>Version</Text>
              <Text style={[baseStyles.th, { width: '20%' }]}>Effective</Text>
              <Text style={[baseStyles.th, { width: '14%' }]}>Owner</Text>
              <Text style={[baseStyles.th, { width: '14%', textAlign: 'right' }]}>Controls</Text>
            </View>
            {active.map((d) => (
              <View key={d.id} style={baseStyles.tr} wrap={false}>
                <Text style={[baseStyles.td, { width: '38%', fontWeight: 600 }]}>{d.title}</Text>
                <Text style={[baseStyles.tdMono, { width: '14%' }]}>{d.version ?? '—'}</Text>
                <Text style={[baseStyles.tdMono, { width: '20%' }]}>{fmtDate(d.effective_date)}</Text>
                <Text style={[baseStyles.td, { width: '14%' }]}>{d.owner ?? '—'}</Text>
                <Text style={[baseStyles.tdNum, { width: '14%' }]}>{d.linked_control_ids.length}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Coverage summary */}
        <Text style={baseStyles.sectionH}>2. Coverage Summary</Text>
        <Text style={baseStyles.para}>
          {byControl.size} of {totalControlCount} NIST CSF 2.0 sub-controls have at
          least one backing policy document on file ({Math.round((byControl.size / Math.max(1, totalControlCount)) * 100)}%
          coverage). Controls without a backing document represent either gaps in the
          written policy stack or controls that don&apos;t require formal documentation.
        </Text>

        {/* Per-document control list */}
        {active.length > 0 && (
          <View>
            <Text style={baseStyles.sectionH}>3. Controls Backed By Each Document</Text>
            {active.map((d) => (
              <View key={d.id} style={{ marginBottom: 14 }} wrap={false}>
                <Text style={{ fontSize: 11, fontWeight: 700, color: palette.ink, marginBottom: 4 }}>
                  {d.title}
                  {d.version && (
                    <Text style={{ fontSize: 9, color: palette.muted, fontWeight: 400 }}>
                      {'  v'}{d.version}
                    </Text>
                  )}
                </Text>
                {d.description && (
                  <Text style={{ fontSize: 9, color: palette.muted, marginBottom: 4 }}>
                    {d.description.length > 240 ? d.description.slice(0, 240) + '…' : d.description}
                  </Text>
                )}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {d.linked_control_ids.length === 0 ? (
                    <Text style={{ fontSize: 9, color: palette.muted, fontStyle: 'italic' }}>
                      No controls linked.
                    </Text>
                  ) : d.linked_control_ids.map((cid) => (
                    <View key={cid} style={{
                      paddingTop: 2, paddingBottom: 2, paddingLeft: 6, paddingRight: 6,
                      marginRight: 4, marginBottom: 4,
                      backgroundColor: palette.bgMute,
                      borderWidth: 0.5, borderColor: palette.rule,
                      borderRadius: 2,
                    }}>
                      <Text style={{ fontSize: 8, color: palette.ink, fontWeight: 600 }}>{cid}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}
