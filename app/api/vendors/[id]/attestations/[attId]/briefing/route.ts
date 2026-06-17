import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { getCurrentUser, canAccessTenant } from '@/lib/auth';
import { VendorBriefingReport } from '@/lib/pdf/VendorBriefingReport';
import type {
  EvidenceArtifact, Risk, Vendor, VendorAttestation,
} from '@/lib/supabase/types';

/**
 * GET /api/vendors/[id]/attestations/[attId]/briefing
 *
 * Streams an executive briefing PDF for one vendor attestation
 * (TPSA / DDQ / SOC 2 / etc.). The briefing combines:
 *
 *   - The vendor's profile (criticality, sensitivity, service)
 *   - The attestation snapshot (status, findings, dates)
 *   - The full checklist response analysis (yes/no/partial/na/unanswered
 *     counts, by-section rollup, and the concerns list)
 *   - Linked risks from the Risk Register
 *   - Linked evidence artifacts from the Evidence Library
 *   - A derived Renew / Conditional / Defer / Terminate recommendation
 *
 * Same response shape as the existing portfolio report route — on a
 * render failure, we emit a plaintext diagnostic instead of an HTML 500
 * the browser would happily save as <name>.pdf.
 *
 * Authorization: anyone with tenant access. The briefing reveals
 * vendor-specific concerns + linked risks, so we gate it through the
 * same canAccessTenant check the rest of the platform uses.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function bad(msg: string, code = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status: code, headers: { 'Content-Type': 'application/json' },
  });
}

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'vendor';
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; attId: string } },
) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved', 404);

  const cu = await getCurrentUser();
  if (!canAccessTenant(cu, tenant.id)) return bad('forbidden', 403);

  const supabase = createServiceRoleClient();

  // Fetch the vendor + attestation + side data in parallel.
  const [vendorRes, attRes] = await Promise.all([
    supabase.from('vendors').select('*').eq('id', params.id).eq('tenant_id', tenant.id).maybeSingle(),
    supabase.from('vendor_attestations').select('*').eq('id', params.attId).eq('tenant_id', tenant.id).maybeSingle(),
  ]);
  if (vendorRes.error) return bad(vendorRes.error.message, 500);
  if (attRes.error)    return bad(attRes.error.message, 500);
  if (!vendorRes.data) return bad('vendor not found', 404);
  if (!attRes.data)    return bad('attestation not found', 404);

  const vendor      = vendorRes.data as Vendor;
  const attestation = attRes.data    as VendorAttestation;
  if (attestation.vendor_id !== vendor.id) {
    return bad('attestation does not belong to this vendor', 400);
  }

  // Linked risks: risks for this tenant whose title/description/rationale
  // reference the vendor name, OR whose linked_control_ids match. We keep
  // the heuristic broad on purpose — the briefing reader wants to see
  // anything related, not nothing.
  const vendorTokenLike = `%${vendor.name.split(/[\s(]/)[0]}%`;
  const [risksRes, evidenceRes] = await Promise.all([
    supabase
      .from('risks')
      .select('*')
      .eq('tenant_id', tenant.id)
      .or(
        `title.ilike.${vendorTokenLike},description.ilike.${vendorTokenLike},rationale.ilike.${vendorTokenLike},code.ilike.${vendorTokenLike}`,
      )
      .order('code', { ascending: true }),
    supabase
      .from('evidence_artifacts')
      .select('*')
      .eq('tenant_id', tenant.id)
      .or(
        `title.ilike.${vendorTokenLike},description.ilike.${vendorTokenLike}`,
      )
      .order('collected_date', { ascending: false }),
  ]);

  const linkedRisks    = (risksRes.data ?? []) as Risk[];
  const linkedEvidence = (evidenceRes.data ?? []) as EvidenceArtifact[];

  const preparedBy =
    cu?.user?.display_name?.trim() ||
    cu?.user?.email ||
    tenant.display_name;

  try {
    const buffer = await renderToBuffer(
      React.createElement(VendorBriefingReport, {
        tenant,
        vendor,
        attestation,
        linkedRisks,
        linkedEvidence,
        preparedBy,
      }) as React.ReactElement,
    );
    const today = new Date().toISOString().slice(0, 10);
    const filename = `${slugify(vendor.name)}-${slugify(attestation.title || attestation.attestation_type)}-briefing-${today}.pdf`;
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control':       'no-store',
      },
    });
  } catch (e: unknown) {
    const err = e as { message?: string; stack?: string };
    console.error('[vendor-briefing] render failed', {
      tenant_slug:   tenant.slug,
      vendor_id:     vendor.id,
      attestation_id: attestation.id,
      message:       err?.message,
      stack:         err?.stack,
    });
    const body =
      'Vendor briefing generation failed.\n\n' +
      `Tenant:        ${tenant.slug}\n` +
      `Vendor:        ${vendor.name}\n` +
      `Attestation:   ${attestation.title || attestation.attestation_type}\n` +
      `Time:          ${new Date().toISOString()}\n\n` +
      `Error: ${err?.message ?? 'unknown error'}\n\n` +
      `Stack:\n${err?.stack ?? '(no stack)'}\n\n` +
      'Please send this file to your SecureOS administrator.\n';
    return new Response(body, {
      status: 500,
      headers: {
        'Content-Type':        'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="vendor-briefing-error.txt"`,
        'Cache-Control':       'no-store',
      },
    });
  }
}
