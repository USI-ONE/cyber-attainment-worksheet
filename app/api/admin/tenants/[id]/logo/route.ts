import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audit, getCurrentUser, isPlatformAdmin } from '@/lib/auth';

/**
 * POST /api/admin/tenants/[id]/logo
 *
 * Accepts a multipart/form-data upload with a single `file` field, stores it
 * in the public `brand-assets` Supabase Storage bucket at
 *   brand-assets/{slug}/logo.{ext}
 * and updates the tenant's brand_config.logo_url to the public URL.
 *
 * Platform-admin only. Logos are part of the tenant's chrome, which any
 * tenant member can see — they're public by design.
 *
 * Format/size guards mirror the bucket policy (which is the canonical
 * enforcement point; this is defense-in-depth so we don't waste a round-trip
 * on a clearly-invalid upload).
 */
export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — matches bucket file_size_limit
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);

  const supabase = createServiceRoleClient();

  // We need the slug to build a stable storage path. (Logo URLs survive
  // display-name changes because slugs are immutable.)
  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select('id, slug, brand_config')
    .eq('id', params.id)
    .maybeSingle();
  if (tErr) return bad(tErr.message, 500);
  if (!tenant) return bad('tenant not found', 404);

  // Parse the multipart form. Next.js handles this natively for route handlers.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad('expected multipart/form-data');
  }

  const file = form.get('file');
  if (!(file instanceof File)) return bad('missing file field');
  if (file.size === 0) return bad('empty file');
  if (file.size > MAX_BYTES) return bad(`file too large (max ${MAX_BYTES / 1024 / 1024}MB)`);

  const ext = MIME_TO_EXT[file.type.toLowerCase()];
  if (!ext) return bad(`unsupported file type: ${file.type || 'unknown'} (allowed: PNG, JPG, SVG, WebP, AVIF)`);

  const path = `${tenant.slug}/logo.${ext}`;

  // If the tenant previously had a logo at a different extension, schedule it
  // for deletion after the new upload succeeds — keeps the bucket from
  // accumulating orphans every time someone switches PNG→JPG etc.
  const oldUrl = (tenant.brand_config as Record<string, unknown> | null)?.logo_url;
  const oldPath = typeof oldUrl === 'string'
    ? oldUrl.match(/\/brand-assets\/([^?]+)/)?.[1]
    : null;

  // Buffer the file so we can hand it to supabase-storage as bytes.
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from('brand-assets')
    .upload(path, bytes, {
      contentType: file.type,
      upsert: true,
      cacheControl: '3600',
    });
  if (upErr) return bad(`upload failed: ${upErr.message}`, 500);

  // Best-effort cleanup of the prior file if the extension changed. Failure
  // here isn't fatal — the new URL is what the tenant will serve from.
  if (oldPath && oldPath !== path) {
    await supabase.storage.from('brand-assets').remove([oldPath]).catch(() => {});
  }

  const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/brand-assets/${path}`;

  // Preserve other brand_config keys (theme, tagline, etc.).
  const newBrandConfig = {
    ...(tenant.brand_config as Record<string, unknown> | null ?? {}),
    logo_url: publicUrl,
  };

  const { error: dbErr } = await supabase
    .from('tenants')
    .update({ brand_config: newBrandConfig })
    .eq('id', params.id);
  if (dbErr) return bad(`db update failed: ${dbErr.message}`, 500);

  await audit({
    actor_id: cu!.user.id,
    tenant_id: params.id,
    action: 'tenant_logo_uploaded',
    detail: { path, size: file.size, mime: file.type },
  });

  return NextResponse.json({ ok: true, logo_url: publicUrl });
}
