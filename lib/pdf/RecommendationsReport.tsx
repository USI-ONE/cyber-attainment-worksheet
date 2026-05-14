import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, registerFonts } from './styles';
import type { Tenant } from '@/lib/supabase/types';
import type { ControlGap, GapSeverity } from '@/lib/recommendations';

/**
 * Practice Gap Recommendations — board-ready printable of the checklist that
 * /recommendations renders interactively.
 *
 * Layout:
 *   1. Cover with summary KPIs + the methodology paragraph the board needs
 *      to know we're not making numbers up.
 *   2. Critical / High gaps section: each control with its tier transition,
 *      assessment Q snapshot, and the recommendation checklist.
 *   3. Moderate / Minor gaps section: condensed table form, since the actions
 *      are smaller and the leadership audience cares less about them.
 *
 * Methodology block matters — auditors and execs want to know the gap math
 * (gol - pra) and where the recommendations come from. We're transparent
 * about it so the report can stand alone without the user explaining it.
 */

registerFonts();

const SEVERITY_LABEL: Record<GapSeverity, string> = {
  critical: 'Critical', high: 'High', moderate: 'Moderate', minor: 'Minor',
};
function severityPillColor(sev: GapSeverity, palette: ReturnType<typeof paletteFor>): string {
  if (sev === 'critical') return palette.severity.critical;
  if (sev === 'high')     return palette.severity.high;
  if (sev === 'moderate') return palette.severity.medium;
  return palette.severity.low;
}

function fmtAnswer(a: string | null): string {
  if (a === 'yes') return 'Yes';
  if (a === 'partial') return 'Partial';
  if (a === 'no') return 'No';
  return '—';
}

export function RecommendationsReport({
  tenant, frameworkName, frameworkVersion, gaps, summary, asOf,
}: {
  tenant: Tenant;
  frameworkName: string;
  frameworkVersion: string;
  gaps: ControlGap[];
  summary: {
    total_gaps: number; critical: number; high: number;
    moderate: number; minor: number;
    total_recommendations: number; avg_gap: number;
  };
  asOf: Date;
}) {
  const palette = paletteFor(tenant);

  const criticalAndHigh = gaps.filter((g) => g.severity === 'critical' || g.severity === 'high');
  const moderateAndMinor = gaps.filter((g) => g.severity === 'moderate' || g.severity === 'minor');

  const pageProps = {
    size: 'LETTER' as const,
    style: baseStyles.page,
  };

  return (
    <Document
      title={`${tenant.display_name} — Practice Gap Recommendations`}
      author={tenant.display_name}
      subject="Cybersecurity Practice Improvement Plan"
    >
      {/* ===== COVER PAGE ===== */}
      <Page {...pageProps}>
        {/* Page header */}
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Practice Gap Recommendations</Text>
        </View>

        {/* Cover block */}
        <View style={[baseStyles.cover, { borderBottomColor: palette.primary }]}>
          <Text style={[baseStyles.coverEyebrow, { color: palette.primary }]}>
            Cybersecurity Improvement Plan
          </Text>
          <Text style={baseStyles.coverTitle}>Practice Gap Recommendations</Text>
          <Text style={baseStyles.coverSub}>
            Every control whose current Practice score is below the target Goal the
            organization set on the worksheet — with the specific next actions that
            close each gap. Framework: {frameworkName} {frameworkVersion}.
          </Text>

          {/* Meta grid */}
          <View style={baseStyles.metaGrid}>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>As of</Text>
              <Text style={baseStyles.metaVal}>{fmtDate(asOf.toISOString())}</Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Controls with open gaps</Text>
              <Text style={baseStyles.metaVal}>{summary.total_gaps}</Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Total recommended actions</Text>
              <Text style={baseStyles.metaVal}>{summary.total_recommendations}</Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Average gap (tiers)</Text>
              <Text style={baseStyles.metaVal}>{summary.avg_gap.toFixed(1)}</Text>
            </View>
          </View>
        </View>

        {/* Severity summary */}
        <Text style={baseStyles.sectionH}>Severity Mix</Text>
        <View style={[baseStyles.table, { marginBottom: 16 }]}>
          <View style={[baseStyles.tr, { borderBottomWidth: 0 }]}>
            <View style={{ width: '25%' }}>
              <Text style={baseStyles.th}>Critical</Text>
              <Text style={{ fontSize: 24, fontWeight: 700, color: palette.severity.critical, marginTop: 2 }}>{summary.critical}</Text>
              <Text style={{ fontSize: 8, color: palette.muted, marginTop: 2 }}>≥ 2-tier gap</Text>
            </View>
            <View style={{ width: '25%' }}>
              <Text style={baseStyles.th}>High</Text>
              <Text style={{ fontSize: 24, fontWeight: 700, color: palette.severity.high, marginTop: 2 }}>{summary.high}</Text>
              <Text style={{ fontSize: 8, color: palette.muted, marginTop: 2 }}>≥ 1.5-tier gap</Text>
            </View>
            <View style={{ width: '25%' }}>
              <Text style={baseStyles.th}>Moderate</Text>
              <Text style={{ fontSize: 24, fontWeight: 700, color: palette.severity.medium, marginTop: 2 }}>{summary.moderate}</Text>
              <Text style={{ fontSize: 8, color: palette.muted, marginTop: 2 }}>≥ 0.5-tier gap</Text>
            </View>
            <View style={{ width: '25%' }}>
              <Text style={baseStyles.th}>Minor</Text>
              <Text style={{ fontSize: 24, fontWeight: 700, color: palette.severity.low, marginTop: 2 }}>{summary.minor}</Text>
              <Text style={{ fontSize: 8, color: palette.muted, marginTop: 2 }}>{'< 0.5-tier gap'}</Text>
            </View>
          </View>
        </View>

        {/* Methodology */}
        <Text style={baseStyles.sectionH}>Methodology</Text>
        <Text style={baseStyles.para}>
          For each control, the current Practice score (PRA) is compared with the
          Goal score the organization declared on the worksheet. The numerical
          gap (gol − pra) drives the severity bucket: a gap ≥ 2 tiers is critical,
          ≥ 1.5 is high, ≥ 0.5 is moderate, less than 0.5 is minor.
        </Text>
        <Text style={baseStyles.para}>
          Recommended actions come from two layered sources. First, the guided
          assessment answers (Q1 documented / Q2 followed / Q3 measured /
          Q4 improvement): a &quot;No&quot; or &quot;Partial&quot; on any question pinpoints the
          specific rung that&apos;s missing — for example, a &quot;No&quot; on Q3 yields a
          recommendation to define metrics and a quarterly review cadence.
          Second, a per-tier transition playbook fills in the universal asks
          for the rung the control is currently on, even where the assessment
          hasn&apos;t been completed yet.
        </Text>
        <Text style={baseStyles.para}>
          The list is sorted critical → minor, then by gap size, so reading
          top-to-bottom is the most efficient order to work through the plan.
        </Text>

        {/* Page footer */}
        <View style={baseStyles.pageFooter} fixed>
          <Text>{tenant.display_name} · Practice Gap Recommendations</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      {/* ===== CRITICAL + HIGH ===== */}
      {criticalAndHigh.length > 0 && (
        <Page {...pageProps}>
          <View style={baseStyles.pageHeader} fixed>
            <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
            <Text style={baseStyles.pageHeaderType}>Critical &amp; High Gaps</Text>
          </View>

          <Text style={[baseStyles.sectionH, { marginTop: 0 }]}>
            Critical &amp; High Gaps — {criticalAndHigh.length} control{criticalAndHigh.length === 1 ? '' : 's'}
          </Text>
          <Text style={[baseStyles.para, { color: palette.muted, fontSize: 9 }]}>
            These are the controls farthest below their declared goal. Address
            in order — each action is sized to be completable in 1–4 weeks by a
            single owner.
          </Text>

          {criticalAndHigh.map((g) => (
            <GapDetail key={g.control_id} gap={g} palette={palette} />
          ))}

          <View style={baseStyles.pageFooter} fixed>
            <Text>{tenant.display_name} · Practice Gap Recommendations</Text>
            <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </Page>
      )}

      {/* ===== MODERATE + MINOR ===== */}
      {moderateAndMinor.length > 0 && (
        <Page {...pageProps}>
          <View style={baseStyles.pageHeader} fixed>
            <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
            <Text style={baseStyles.pageHeaderType}>Moderate &amp; Minor Gaps</Text>
          </View>

          <Text style={[baseStyles.sectionH, { marginTop: 0 }]}>
            Moderate &amp; Minor Gaps — {moderateAndMinor.length} control{moderateAndMinor.length === 1 ? '' : 's'}
          </Text>
          <Text style={[baseStyles.para, { color: palette.muted, fontSize: 9 }]}>
            Smaller gaps. Handle as bandwidth allows — many will resolve
            naturally as the higher-severity work cascades.
          </Text>

          {moderateAndMinor.map((g) => (
            <GapDetail key={g.control_id} gap={g} palette={palette} condensed />
          ))}

          <View style={baseStyles.pageFooter} fixed>
            <Text>{tenant.display_name} · Practice Gap Recommendations</Text>
            <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </Page>
      )}

      {/* Empty-state page for the rare "no gaps" case */}
      {gaps.length === 0 && (
        <Page {...pageProps}>
          <View style={baseStyles.pageHeader} fixed>
            <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
            <Text style={baseStyles.pageHeaderType}>Practice Gap Recommendations</Text>
          </View>
          <Text style={[baseStyles.sectionH, { marginTop: 0 }]}>No Open Gaps</Text>
          <Text style={baseStyles.para}>
            Every scored control is at or above its declared goal as of{' '}
            {fmtDate(asOf.toISOString())}. The most productive next step is to
            re-examine goals on the worksheet to ensure they remain ambitious,
            and to extend assessment coverage to any control still without a
            score.
          </Text>
          <View style={baseStyles.pageFooter} fixed>
            <Text>{tenant.display_name} · Practice Gap Recommendations</Text>
            <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </Page>
      )}
    </Document>
  );
}

/**
 * One control block — header bar, assessment Q snapshot, then the
 * recommendation checklist as bullet rows with empty check-circles.
 * Condensed mode trims to a single-line layout for moderate/minor gaps.
 */
function GapDetail({ gap, palette, condensed }: {
  gap: ControlGap;
  palette: ReturnType<typeof paletteFor>;
  condensed?: boolean;
}) {
  const sevColor = severityPillColor(gap.severity, palette);
  return (
    <View
      style={{
        marginBottom: condensed ? 8 : 14,
        paddingTop: condensed ? 6 : 10,
        paddingBottom: condensed ? 6 : 10,
        paddingLeft: 10, paddingRight: 10,
        backgroundColor: palette.bgMute,
        borderLeftWidth: 3, borderLeftColor: sevColor,
        borderRadius: 3,
      }}
      wrap={false}
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 11, color: palette.ink }}>
          {gap.control_id}
        </Text>
        <Text style={{ fontSize: 8, color: palette.muted }}>
          {gap.group_name} · {gap.category_name}
        </Text>
        <View
          style={[
            baseStyles.pill,
            { backgroundColor: sevColor, color: '#FFFFFF', marginLeft: 'auto' },
          ]}
        >
          <Text>{SEVERITY_LABEL[gap.severity]}</Text>
        </View>
      </View>

      <Text style={{ fontSize: 10, color: palette.body, marginTop: 4, marginBottom: 6 }}>
        {gap.outcome}
      </Text>

      {/* Tier transition + assessment snapshot */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: condensed ? 4 : 8 }}>
        <Text style={{ fontSize: 9, color: palette.muted, marginRight: 12 }}>
          <Text style={{ color: palette.ink, fontFamily: 'Helvetica-Bold' }}>
            {gap.current_tier}
          </Text>
          <Text> → </Text>
          <Text style={{ color: palette.ink, fontFamily: 'Helvetica-Bold' }}>
            {gap.target_tier}
          </Text>
          <Text>  (gap +{gap.gap.toFixed(1)})</Text>
        </Text>
        {gap.owner && (
          <Text style={{ fontSize: 9, color: palette.muted, marginRight: 12 }}>
            Owner: <Text style={{ color: palette.ink }}>{gap.owner}</Text>
          </Text>
        )}
        {!condensed && (
          <Text style={{ fontSize: 9, color: palette.muted }}>
            Q1 {fmtAnswer(gap.q1)} · Q2 {fmtAnswer(gap.q2)} · Q3 {fmtAnswer(gap.q3)} · Q4 {gap.q4 ? 'Yes' : 'No'}
          </Text>
        )}
      </View>

      {/* Recommendation checklist */}
      {gap.recommendations.map((r) => (
        <View
          key={r.id}
          style={{ flexDirection: 'row', marginBottom: condensed ? 2 : 4, alignItems: 'flex-start' }}
        >
          <Text style={{
            width: 12, fontSize: 11, color: palette.muted, marginTop: -1,
          }}>☐</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 10, color: palette.ink, fontFamily: 'Helvetica-Bold' }}>
              {r.action}
            </Text>
            {!condensed && (
              <Text style={{ fontSize: 8.5, color: palette.muted, lineHeight: 1.4, marginTop: 1 }}>
                {r.why}
              </Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
