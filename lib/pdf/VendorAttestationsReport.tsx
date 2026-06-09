/* eslint-disable jsx-a11y/alt-text */
import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, registerFonts } from './styles';
import type {
  AttestationStatus,
  AttestationType,
  Tenant,
  Vendor,
  VendorAttestation,
  VendorCriticality,
} from '@/lib/supabase/types';

/**
 * Third-Party Vendor Risk Summary — board-ready PDF.
 *
 * Designed to answer the four questions a board actually asks:
 *
 *   1. How many vendors? Of those, how many are critical?
 *   2. What's expired? What's expiring within 90 days?
 *   3. Which critical vendors lack a current attestation?
 *   4. Show me the full inventory.
 *
 * Each section is short and table-based. The report intentionally
 * surfaces gaps (expired attestations, missing attestations on critical
 * vendors) above the inventory so the actionable list is on page 2.
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
  penetration_test:  'Pen Test',
  vulnerability_scan: 'Vuln Scan',
  tpsa:              'TPSA',
  ddq:               'DDQ',
  other:             'Other',
};

const CRIT_COLOR: Record<VendorCriticality, string> = {
  low:      '#64748B',
  medium:   '#F59E0B',
  high:     '#DC2626',
  critical: '#991B1B',
};

const STATUS_COLOR: Record<AttestationStatus, string> = {
  pending:    '#F59E0B',
  current:    '#10B981',
  expired:    '#DC2626',
  superseded: '#94A3B8',
  archived:   '#64748B',
};

const DAY = 86_400_000;

type VendorWithAttestations = Vendor & { attestations: VendorAttestation[] };

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / DAY);
}

function attLine(a: VendorAttestation): string {
  const lbl = ATTESTATION_LABEL[a.attestation_type] ?? a.attestation_type;
  const exp = a.expires_on ? `exp ${a.expires_on}` : 'no expiry';
  return `${lbl} — ${exp} (${a.status})`;
}

export function VendorAttestationsReport({
  tenant, vendors, attestations, preparedBy,
}: {
  tenant: Tenant;
  vendors: Vendor[];
  attestations: VendorAttestation[];
  preparedBy: string;
}) {
  const palette = paletteFor(tenant);
  const generated = new Date();

  // Index attestations by vendor for fast lookup in each section.
  const byVendor = new Map<string, VendorAttestation[]>();
  for (const a of attestations) {
    const list = byVendor.get(a.vendor_id) ?? [];
    list.push(a);
    byVendor.set(a.vendor_id, list);
  }
  const enriched: VendorWithAttestations[] = vendors.map((v) => ({
    ...v,
    attestations: byVendor.get(v.id) ?? [],
  }));

  // KPI rollups
  const activeVendors = enriched.filter((v) => v.status === 'active');
  const criticalCount = activeVendors.filter((v) => v.criticality === 'critical').length;
  const highCount     = activeVendors.filter((v) => v.criticality === 'high').length;

  const currentAtts = attestations.filter((a) => a.status === 'current');
  const expired = currentAtts.filter((a) => {
    const d = daysUntil(a.expires_on);
    return d !== null && d < 0;
  });
  const expiringSoon = currentAtts.filter((a) => {
    const d = daysUntil(a.expires_on);
    return d !== null && d >= 0 && d <= 90;
  });

  // Vendors with NO current attestation — surface these to the board.
  const noCurrentAttestation = activeVendors.filter(
    (v) => !v.attestations.some((a) => a.status === 'current'),
  );

  // Order critical vendors first, then high, then alphabetical.
  const ranked: VendorWithAttestations[] = [...activeVendors].sort((a, b) => {
    const order: VendorCriticality[] = ['critical', 'high', 'medium', 'low'];
    const ai = order.indexOf(a.criticality);
    const bi = order.indexOf(b.criticality);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });

  // Vendors needing attention: anything expired, expiring within 90, or
  // missing a current attestation. Sorted critical-first.
  const attentionVendorIds = new Set<string>([
    ...expired.map((a) => a.vendor_id),
    ...expiringSoon.map((a) => a.vendor_id),
    ...noCurrentAttestation.map((v) => v.id),
  ]);
  const attentionVendors = ranked.filter((v) => attentionVendorIds.has(v.id));

  return (
    <Document
      title={`Third-Party Vendor Risk Summary — ${tenant.display_name}`}
      author={preparedBy}
      subject="Third-Party Vendor Risk Summary"
      creator="SecureOS"
    >
      <Page size="LETTER" style={baseStyles.page}>
        {/* Header + footer (every page) */}
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · Third-Party Vendor Risk</Text>
        </View>
        <View style={baseStyles.pageFooter} fixed>
          <Text>Prepared {fmtDate(generated.toISOString())} · {preparedBy}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        {/* Cover */}
        <View style={[baseStyles.cover, { borderBottomColor: palette.primary }]}>
          <Text style={[baseStyles.coverEyebrow, { color: palette.primary }]}>
            Third-Party Vendor Risk
          </Text>
          <Text style={baseStyles.coverTitle}>Vendor Risk Summary</Text>
          <Text style={[baseStyles.coverSub, { marginTop: 6 }]}>
            Prepared for: Chief Executive Officer · Chief Financial Officer · Board Members
          </Text>

          <View style={[baseStyles.metaGrid, { marginTop: 18 }]}>
            <MetaItem label="Active vendors"     value={activeVendors.length.toString()} />
            <MetaItem label="Critical-tier"      value={`${criticalCount} critical · ${highCount} high`} />
            <MetaItem label="Expired attestations" value={expired.length.toString()} />
            <MetaItem label="Expiring ≤ 90 days"  value={expiringSoon.length.toString()} />
            <MetaItem label="No current attestation" value={noCurrentAttestation.length.toString()} />
            <MetaItem label="Total attestations on file" value={attestations.length.toString()} />
          </View>
        </View>

        {/* SECTION 1 — Vendors Requiring Attention */}
        <View style={baseStyles.sectionBody}>
          <Text style={baseStyles.sectionH}>1. Vendors Requiring Attention</Text>
          {attentionVendors.length === 0 ? (
            <Text style={[baseStyles.para, { color: palette.muted }]}>
              No vendors currently flagged. Every active vendor has at least one current attestation and none are expired or expiring within 90 days.
            </Text>
          ) : (
            <View style={baseStyles.table}>
              <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
                <Text style={[baseStyles.th, { width: '36%' }]}>Vendor</Text>
                <Text style={[baseStyles.th, { width: '14%' }]}>Tier</Text>
                <Text style={[baseStyles.th, { width: '50%' }]}>Status</Text>
              </View>
              {attentionVendors.map((v) => {
                const reasons: string[] = [];
                if (!v.attestations.some((a) => a.status === 'current')) {
                  reasons.push('No current attestation on file');
                }
                for (const a of v.attestations) {
                  if (a.status !== 'current') continue;
                  const d = daysUntil(a.expires_on);
                  if (d === null) continue;
                  if (d < 0) {
                    reasons.push(`${ATTESTATION_LABEL[a.attestation_type]} expired ${-d} day${-d === 1 ? '' : 's'} ago`);
                  } else if (d <= 90) {
                    reasons.push(`${ATTESTATION_LABEL[a.attestation_type]} expires in ${d} day${d === 1 ? '' : 's'}`);
                  }
                }
                return (
                  <View key={v.id} style={baseStyles.tr} wrap={false}>
                    <Text style={[baseStyles.td, { width: '36%' }]}>{v.name}</Text>
                    <View style={{ width: '14%' }}>
                      <Pill color={CRIT_COLOR[v.criticality]}>{v.criticality}</Pill>
                    </View>
                    <View style={{ width: '50%' }}>
                      {reasons.map((r, i) => (
                        <Text key={i} style={[baseStyles.td, { fontSize: 9 }]}>• {r}</Text>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* SECTION 2 — Critical Vendors Detail */}
        {ranked.filter((v) => v.criticality === 'critical').length > 0 && (
          <View style={baseStyles.sectionBody}>
            <Text style={baseStyles.sectionH}>2. Critical Vendors — Attestation Detail</Text>
            <Text style={[baseStyles.para, { color: palette.muted, fontSize: 9 }]}>
              Every active vendor at criticality = critical and the attestations currently on file.
            </Text>
            <View style={baseStyles.table}>
              <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
                <Text style={[baseStyles.th, { width: '32%' }]}>Vendor</Text>
                <Text style={[baseStyles.th, { width: '14%' }]}>Data</Text>
                <Text style={[baseStyles.th, { width: '54%' }]}>Attestations</Text>
              </View>
              {ranked.filter((v) => v.criticality === 'critical').map((v) => {
                const lines = v.attestations.length === 0
                  ? ['(none on file)']
                  : v.attestations.map(attLine);
                return (
                  <View key={v.id} style={baseStyles.tr} wrap={false}>
                    <Text style={[baseStyles.td, { width: '32%' }]}>{v.name}</Text>
                    <Text style={[baseStyles.tdMono, { width: '14%' }]}>{v.data_sensitivity}</Text>
                    <View style={{ width: '54%' }}>
                      {lines.map((l, i) => (
                        <Text key={i} style={[baseStyles.td, { fontSize: 9 }]}>{l}</Text>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* SECTION 3 — Full Inventory */}
        <View style={baseStyles.sectionBody}>
          <Text style={baseStyles.sectionH}>3. Full Vendor Inventory</Text>
          <View style={baseStyles.table}>
            <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
              <Text style={[baseStyles.th, { width: '38%' }]}>Vendor</Text>
              <Text style={[baseStyles.th, { width: '14%' }]}>Type</Text>
              <Text style={[baseStyles.th, { width: '14%' }]}>Crit</Text>
              <Text style={[baseStyles.th, { width: '14%' }]}>Data</Text>
              <Text style={[baseStyles.th, { width: '20%' }]}>Owner</Text>
            </View>
            {ranked.map((v) => (
              <View key={v.id} style={baseStyles.tr} wrap={false}>
                <Text style={[baseStyles.td, { width: '38%' }]}>{v.name}</Text>
                <Text style={[baseStyles.tdMono, { width: '14%', fontSize: 9 }]}>{v.vendor_type}</Text>
                <Text style={[baseStyles.tdMono, { width: '14%', fontSize: 9, color: CRIT_COLOR[v.criticality], fontWeight: 600 }]}>
                  {v.criticality}
                </Text>
                <Text style={[baseStyles.tdMono, { width: '14%', fontSize: 9 }]}>{v.data_sensitivity}</Text>
                <Text style={[baseStyles.td, { width: '20%', fontSize: 9 }]}>{v.owner ?? '—'}</Text>
              </View>
            ))}
          </View>
        </View>

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

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={baseStyles.metaItem}>
      <Text style={baseStyles.metaLabel}>{label}</Text>
      <Text style={baseStyles.metaVal}>{value}</Text>
    </View>
  );
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <View style={{
      paddingTop: 2, paddingBottom: 2, paddingLeft: 8, paddingRight: 8,
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
// Silence unused import lint warnings on imports kept for future sections.
void STATUS_COLOR;
