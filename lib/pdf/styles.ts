import { StyleSheet, Font } from '@react-pdf/renderer';
import type { Tenant } from '@/lib/supabase/types';

/**
 * Shared @react-pdf/renderer styles + helpers used by every executive report.
 *
 * The reports run in a Node API route, render to a binary PDF buffer, and
 * stream that to the browser as a download. The visual design intentionally
 * skews understated and print-friendly — board members read these on iPads
 * and on paper, so we use heavy whitespace, restrained color, and tabular
 * numerals so columns line up at any zoom.
 */

// Font strategy: @react-pdf ships with Helvetica / Times-Roman / Courier as
// PDF core fonts (no network fetch needed). For brand-feel parity we'd love to
// use Inter + Oswald like the live UI does, but registering remote fonts means
// every cold-start function fetches them from Google Fonts and any blip in
// outbound network kills the whole render. So we stay on the bullet-proof
// core-font path by default. The base styles below use the @react-pdf
// "Helvetica" alias which always resolves without a network round-trip.
//
// If you ever want to upgrade visual fidelity, drop a TTF file under
// public/fonts/ and pass src: '<absolute-url-to-self-hosted-ttf>' here —
// keeping registration self-hosted is far more reliable than gstatic.
let _fontsRegistered = false;
export function registerFonts() {
  if (_fontsRegistered) return;
  // No-op for now (see comment above). Kept as a function so callers can
  // continue to reference it idempotently as we grow the report set.
  void Font; // suppress "unused import" without removing the symbol
  _fontsRegistered = true;
}

/** Color palette pulled from a tenant's brand_config so each PDF carries
 *  the right accent. Falls back to platform gold so an unbranded tenant
 *  still gets a polished cover. */
export function paletteFor(tenant: Tenant) {
  const brand = (tenant.brand_config ?? {}) as { theme?: { primary?: string; secondary?: string; accent?: string } };
  return {
    primary:   brand.theme?.primary   ?? '#C9A961',
    secondary: brand.theme?.secondary ?? '#5B7FA8',
    accent:    brand.theme?.accent    ?? '#E8E4DA',
    ink:       '#111111',
    body:      '#333333',
    muted:     '#6B6B6B',
    rule:      '#D9D9D9',
    bgMute:    '#F4F4F4',
    severity: {
      low:      '#6B7280',
      medium:   '#B89B5E',
      high:     '#C2410C',
      critical: '#991B1B',
    },
    status: {
      open:      '#991B1B',
      contained: '#B89B5E',
      closed:    '#15803D',
    },
  };
}

/** Base stylesheet — sized for letter paper at standard print scale. */
export const baseStyles = StyleSheet.create({
  page: {
    paddingTop:    72,    // 1in top
    paddingBottom: 72,    // 1in bottom — leaves room for the page-number footer
    paddingLeft:   54,    // 0.75in
    paddingRight:  54,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#333333',
    lineHeight: 1.5,
  },
  // Header/footer absolute-positioned (pinned via Page props)
  pageHeader: {
    position: 'absolute',
    top: 28, left: 54, right: 54,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#D9D9D9',
  },
  pageHeaderTenant: {
    fontFamily: 'Helvetica-Bold', fontSize: 9, fontWeight: 600,
    letterSpacing: 1.2, textTransform: 'uppercase', color: '#111111',
  },
  pageHeaderType: {
    fontSize: 8, color: '#6B6B6B', letterSpacing: 0.5,
  },
  pageFooter: {
    position: 'absolute',
    bottom: 28, left: 54, right: 54,
    flexDirection: 'row', justifyContent: 'space-between',
    fontSize: 8, color: '#6B6B6B',
  },

  // Cover block
  cover: {
    marginTop: 40,
    marginBottom: 28,
    paddingBottom: 18,
    borderBottomWidth: 2,
  },
  coverEyebrow: {
    fontFamily: 'Helvetica-Bold', fontSize: 10, fontWeight: 600,
    letterSpacing: 2, textTransform: 'uppercase',
    marginBottom: 10,
  },
  coverTitle: {
    fontSize: 22, fontWeight: 700, lineHeight: 1.2,
    color: '#111111', marginBottom: 8,
  },
  coverSub: {
    fontSize: 11, color: '#6B6B6B', lineHeight: 1.4,
  },

  // Section blocks
  sectionH: {
    fontFamily: 'Helvetica-Bold', fontSize: 11, fontWeight: 600,
    letterSpacing: 1.5, textTransform: 'uppercase',
    color: '#111111',
    marginTop: 18, marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 0.5, borderBottomColor: '#D9D9D9',
  },
  sectionBody: { marginBottom: 4 },
  para: { marginBottom: 6 },

  // Bullet list
  bullet: { flexDirection: 'row', marginBottom: 4 },
  bulletDot: { width: 12, color: '#6B6B6B' },
  bulletBody: { flex: 1 },

  // Two-column meta grid (used on the cover)
  metaGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    marginTop: 16,
  },
  metaItem: { width: '50%', marginBottom: 10 },
  metaLabel: {
    fontFamily: 'Helvetica-Bold', fontSize: 8, fontWeight: 600,
    letterSpacing: 1, textTransform: 'uppercase', color: '#6B6B6B',
    marginBottom: 2,
  },
  metaVal: { fontSize: 10, color: '#111111' },

  // Pill (severity / status badges on cover)
  pill: {
    paddingTop: 2, paddingBottom: 2, paddingLeft: 8, paddingRight: 8,
    borderRadius: 999, fontSize: 9, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: 0.6,
    alignSelf: 'flex-start',
  },

  // Table
  table: { marginTop: 4, marginBottom: 8, width: '100%' },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 0.5, borderBottomColor: '#E5E5E5',
    paddingTop: 5, paddingBottom: 5,
  },
  th: {
    fontFamily: 'Helvetica-Bold', fontSize: 8, fontWeight: 600,
    letterSpacing: 1, textTransform: 'uppercase', color: '#6B6B6B',
  },
  td: { fontSize: 10, color: '#333333' },
  tdMono: {
    fontSize: 9, color: '#333333',
    fontFamily: 'Helvetica',
  },
  tdNum: { fontSize: 10, color: '#111111', textAlign: 'right' },

  // Signature block at the bottom
  signBlock: {
    marginTop: 24, paddingTop: 12,
    borderTopWidth: 0.5, borderTopColor: '#D9D9D9',
    flexDirection: 'row', justifyContent: 'space-between',
  },
  signCol: { width: '32%' },
  signLine: {
    height: 22,
    borderBottomWidth: 0.5, borderBottomColor: '#111111',
    marginBottom: 4,
  },
  signLabel: { fontSize: 8, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: 1 },
});

/** Format an ISO timestamp for board-friendly display. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}
