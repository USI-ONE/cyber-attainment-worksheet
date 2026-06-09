import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { VendorAttestationsReport } from '@/lib/pdf/VendorAttestationsReport';
import type { Vendor, VendorAttestation } from '@/lib/supabase/types';

/**
 * GET /api/report/vendor-attestations
 *
 * Streams the board-ready Third-Party Vendor Risk Summary PDF for the
 * current tenant. Same response-shape pattern as
 * /api/incidents/[id]/report — try/catch wraps the render so a failure
 * produces a downloadable plaintext diagnostic instead of an HTML 500
 * that the browser would save as <name>.pdf.
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
    .slice(0, 80) || 'tenant';
}

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();
  const [vendorsRes, attestationsRes] = await Promise.all([
    supabase.from('vendors').select('*').eq('tenant_id', tenant.id),
    supabase.from('vendor_attestations').select('*').eq('tenant_id', tenant.id),
  ]);
  if (vendorsRes.error)      return bad(vendorsRes.error.message, 500);
  if (attestationsRes.error) return bad(attestationsRes.error.message, 500);

  const preparedBy = tenant.display_name;

  try {
    const buffer = await renderToBuffer(
      React.createElement(VendorAttestationsReport, {
        tenant,
        vendors:      (vendorsRes.data ?? []) as Vendor[],
        attestations: (attestationsRes.data ?? []) as VendorAttestation[],
        preparedBy,
      }) as React.ReactElement,
    );
    const filename = `${slugify(tenant.slug)}-vendor-risk-${new Date().toISOString().slice(0, 10)}.pdf`;
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    const err = e as { message?: string; stack?: string };
    console.error('[vendor-attestations-report] render failed', {
      tenant_slug: tenant.slug,
      vendors_count: vendorsRes.data?.length ?? 0,
      attestations_count: attestationsRes.data?.length ?? 0,
      message: err?.message,
      stack: err?.stack,
    });
    const body =
      'Vendor risk report generation failed.\n\n' +
      `Tenant:    ${tenant.slug}\n` +
      `Time:      ${new Date().toISOString()}\n` +
      `Vendors:        ${vendorsRes.data?.length ?? 0}\n` +
      `Attestations:   ${attestationsRes.data?.length ?? 0}\n\n` +
      `Error: ${err?.message ?? 'unknown error'}\n\n` +
      `Stack:\n${err?.stack ?? '(no stack)'}\n\n` +
      'Please send this file to your SecureOS administrator.\n';
    return new Response(body, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="vendor-risk-report-error.txt"`,
        'Cache-Control': 'no-store',
      },
    });
  }
}
