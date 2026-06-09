import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, registerFonts } from './styles';
import type { Tenant } from '@/lib/supabase/types';
import type { CrosswalkRelationship } from '@/lib/crosswalk';

/**
 * Compliance Crosswalk PDF — the auditor's "show me ISO 27001 coverage
 * based on our NIST CSF scoring" deliverable.
 *
 * Structure:
 *   1. Cover with source / target framework + KPI roll-up (target controls,
 *      mapped count, gaps, weighted average inherited Practice).
 *   2. Coverage summary table — every target control with its inherited
 *      Practice score + source-contributor count.
 *   3. Per-control detail — target control id + outcome + each source
 *      contributor (with relationship + source's own Practice score).
 *   4. Attestation block — Engagement Lead / Tenant Sponsor / Auditor.
 *
 * Data shape is what the existing computeInheritedCoverage() helper
 * already returns; this report doesn't query the DB itself — the API
 * route hands it everything pre-joined.
 */

registerFonts();

export interface CrosswalkTargetControl {
  control_id: string;
  outcome: string;
  group_id: string;
  group_name: string;
  category_id: string;
  category_name: string;
  inherited_pra: number | null;
  inherited_pol: number | null;
  source_count: number;
  contributors: {
    source_control_id: string;
    source_outcome: string | null;
    relationship: CrosswalkRelationship;
    pra: number | null;
    pol: number | null;
  }[];
}

const RELATIONSHIP_LABEL: Record<CrosswalkRelationship, string> = {
  equivalent: 'Equivalent',
  related:    'Related',
  partial:    'Partial',
};

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
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
}

function relationshipColor(r: CrosswalkRelationship, palette: ReturnType<typeof paletteFor>): string {
  if (r === 'equivalent') return palette.status.closed;
  if (r === 'related')    return palette.severity.medium;
  return palette.muted;
}

export function CrosswalkReport({
  tenant, sourceName, sourceVersion, targetName, targetVersion,
  targetControls, asOf,
}: {
  tenant: Tenant;
  sourceName: string;
  sourceVersion: string;
  targetName: string;
  targetVersion: string;
  targetControls: CrosswalkTargetControl[];
  asOf: Date;
}) {
  const palette = paletteFor(tenant);

  // Roll-ups for the cover.
  const total = targetControls.length;
  const mapped = targetControls.filter((c) => c.source_count > 0).length;
  const gaps = total - mapped;
  const praValues = targetControls.map((c) => c.inherited_pra).filter((v): v is number => v != null);
  const avgPra = praValues.length ? praValues.reduce((a, b) => a + b, 0) / praValues.length : null;

  // Group target controls by their parent group for readable section breaks.
  const byGroup = new Map<string, CrosswalkTargetControl[]>();
  const groupOrder: { id: string; name: string }[] = [];
  for (const c of targetControls) {
    if (!byGroup.has(c.group_id)) {
      byGroup.set(c.group_id, []);
      groupOrder.push({ id: c.group_id, name: c.group_name });
    }
    byGroup.get(c.group_id)!.push(c);
  }

  return (
    <Document
      title={`${tenant.display_name} — ${targetName} Coverage via ${sourceName}`}
      author={tenant.display_name}
      subject="Compliance Crosswalk"
      creator="SecureOS"
    >
      {/* ====================== Cover ====================== */}
      <Page size="LETTER" style={baseStyles.page}>
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · Compliance Crosswalk</Text>
        </View>
        <View style={baseStyles.pageFooter} fixed>
          <Text>As of {fmtDate(asOf.toISOString())}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        <View style={[baseStyles.cover, { borderBottomColor: palette.primary }]}>
          <Text style={[baseStyles.coverEyebrow, { color: palette.primary }]}>
            Compliance Crosswalk
          </Text>
          <Text style={baseStyles.coverTitle}>
            {targetName} coverage inherited from {sourceName}
          </Text>
          <Text style={[baseStyles.coverSub, { marginTop: 6 }]}>
            Prepared for: External auditor · Compliance Lead · Executive Sponsor
          </Text>

          <View style={[baseStyles.metaGrid, { marginTop: 18 }]}>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>{targetName} Controls</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {total}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                v{targetVersion}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Mapped from {sourceName}</Text>
              <Text style={[baseStyles.metaVal, {
                fontSize: 18, fontWeight: 700,
                color: mapped >= total / 2 ? palette.status.closed : palette.severity.medium,
              }]}>
                {mapped} / {total}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                v{sourceVersion}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Coverage Gaps</Text>
              <Text style={[baseStyles.metaVal, {
                fontSize: 18, fontWeight: 700,
                color: gaps > 0 ? palette.severity.high : palette.status.closed,
              }]}>
                {gaps}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                {gaps > 0 ? 'no mapped source control' : 'fully covered'}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Avg Inherited Practice</Text>
              <Text style={[baseStyles.metaVal, {
                fontSize: 18, fontWeight: 700, color: tierColor(avgPra, palette),
              }]}>
                {fmtScore(avgPra)}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                weighted; equivalent ×1.0, related ×0.7, partial ×0.4
              </Text>
            </View>
          </View>
        </View>

        <Text style={[baseStyles.para, { fontSize: 9, color: palette.muted, marginTop: 4 }]}>
          This report assembles {tenant.display_name}&apos;s coverage on {targetName} by
          inheriting Practice scores from {sourceName} via the platform&apos;s seeded
          control mappings. Where mappings are missing, the target control is marked
          as a coverage gap. The inherited score is a weighted average across every
          mapped source control: equivalent mappings count fully, related two-thirds,
          partial less. Verify mappings before treating inheritance as audit evidence
          — the source set was curated from NIST&apos;s informative-reference
          publication and may not reflect organizational nuance.
        </Text>

        <Text style={baseStyles.sectionH}>Coverage Summary</Text>
        <View style={baseStyles.table}>
          <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
            <Text style={[baseStyles.th, { width: '12%' }]}>Control</Text>
            <Text style={[baseStyles.th, { width: '52%' }]}>Outcome</Text>
            <Text style={[baseStyles.th, { width: '12%', textAlign: 'right' }]}>Sources</Text>
            <Text style={[baseStyles.th, { width: '12%', textAlign: 'right' }]}>Inherited Pra</Text>
            <Text style={[baseStyles.th, { width: '12%', textAlign: 'right' }]}>Inherited Pol</Text>
          </View>
          {targetControls.map((c) => (
            <View key={c.control_id} style={baseStyles.tr} wrap={false}>
              <Text style={[baseStyles.tdMono, { width: '12%', fontWeight: 700 }]}>{c.control_id}</Text>
              <Text style={[baseStyles.td, { width: '52%' }]}>{c.outcome}</Text>
              <Text style={[baseStyles.td, { width: '12%', textAlign: 'right',
                color: c.source_count === 0 ? palette.severity.high : palette.body,
                fontWeight: c.source_count === 0 ? 700 : 400,
              }]}>
                {c.source_count === 0 ? 'gap' : c.source_count}
              </Text>
              <Text style={[baseStyles.td, {
                width: '12%', textAlign: 'right',
                color: tierColor(c.inherited_pra, palette), fontWeight: 700,
              }]}>
                {fmtScore(c.inherited_pra)}
              </Text>
              <Text style={[baseStyles.td, {
                width: '12%', textAlign: 'right',
                color: tierColor(c.inherited_pol, palette), fontWeight: 700,
              }]}>
                {fmtScore(c.inherited_pol)}
              </Text>
            </View>
          ))}
        </View>
      </Page>

      {/* ====================== Per-group detail ====================== */}
      {groupOrder.map((g) => {
        const ctrls = byGroup.get(g.id) ?? [];
        return (
          <Page key={g.id} size="LETTER" style={baseStyles.page}>
            <View style={baseStyles.pageHeader} fixed>
              <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
              <Text style={baseStyles.pageHeaderType}>Crosswalk · {g.id}</Text>
            </View>
            <View style={baseStyles.pageFooter} fixed>
              <Text>As of {fmtDate(asOf.toISOString())}</Text>
              <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
            </View>

            <View style={{
              marginBottom: 14, paddingBottom: 10,
              borderBottomWidth: 2, borderBottomColor: palette.primary,
            }}>
              <Text style={{
                fontFamily: 'Helvetica-Bold', fontSize: 9, color: palette.primary,
                letterSpacing: 1.5, textTransform: 'uppercase',
              }}>
                {targetName} · {g.id}
              </Text>
              <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 18, color: palette.ink, marginTop: 4 }}>
                {g.name}
              </Text>
            </View>

            {ctrls.map((c) => (
              <View key={c.control_id} style={{
                marginBottom: 12, paddingBottom: 6, paddingLeft: 10,
                borderLeftWidth: 2,
                borderLeftColor: c.source_count === 0 ? palette.severity.high : palette.primary,
              }} wrap={false}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 3 }}>
                  <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 10, color: palette.primary, width: 64 }}>
                    {c.control_id}
                  </Text>
                  <Text style={{ fontSize: 10, color: palette.ink, flex: 1, fontWeight: 700 }}>
                    {c.outcome}
                  </Text>
                </View>

                {c.source_count === 0 ? (
                  <Text style={{ fontSize: 9, color: palette.severity.high, fontStyle: 'italic', marginLeft: 64 }}>
                    Coverage gap — no {sourceName} control is mapped to this {targetName} control.
                  </Text>
                ) : (
                  <View style={{ marginLeft: 64 }}>
                    <Text style={{ fontSize: 9, color: palette.body, marginBottom: 4 }}>
                      Inherited Practice: <Text style={{ color: tierColor(c.inherited_pra, palette), fontWeight: 700 }}>
                        {fmtScore(c.inherited_pra)}
                      </Text>{' '}
                      from {c.source_count} {sourceName} control{c.source_count === 1 ? '' : 's'}.
                    </Text>
                    {c.contributors.map((src, i) => {
                      const rColor = relationshipColor(src.relationship, palette);
                      return (
                        <View key={i} style={{ flexDirection: 'row', marginBottom: 2 }} wrap={false}>
                          <Text style={{ width: 64, fontSize: 8, color: palette.muted, fontFamily: 'Helvetica-Bold' }}>
                            {src.source_control_id}
                          </Text>
                          <Text style={{ flex: 1, fontSize: 8, color: palette.body }}>
                            {src.source_outcome ?? '—'}
                          </Text>
                          <Text style={{
                            width: 64, fontSize: 7.5, color: rColor, fontWeight: 700,
                            textTransform: 'uppercase', letterSpacing: 0.6,
                          }}>
                            {RELATIONSHIP_LABEL[src.relationship]}
                          </Text>
                          <Text style={{
                            width: 24, fontSize: 8, fontWeight: 700,
                            color: tierColor(src.pra, palette), textAlign: 'right',
                          }}>
                            {fmtScore(src.pra)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            ))}
          </Page>
        );
      })}

      {/* ====================== Attestation page ====================== */}
      <Page size="LETTER" style={baseStyles.page}>
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · Compliance Crosswalk</Text>
        </View>
        <View style={baseStyles.pageFooter} fixed>
          <Text>As of {fmtDate(asOf.toISOString())}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        <Text style={baseStyles.sectionH}>Attestation</Text>
        <Text style={[baseStyles.para, { color: palette.body }]}>
          The undersigned attest that {tenant.display_name}&apos;s {sourceName} v{sourceVersion}
          scoring (current as of {fmtDate(asOf.toISOString())}) is the basis for the inherited
          coverage on {targetName} v{targetVersion} summarized in this binder. Where mappings
          differ from the auditor&apos;s expectation, refinements should be recorded in SecureOS
          via the Compliance Crosswalk admin tools.
        </Text>
        <Text style={[baseStyles.para, { color: palette.muted, fontSize: 9 }]}>
          This report is a derivative of live scoring data. Re-run after material changes for
          a refreshed snapshot.
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
