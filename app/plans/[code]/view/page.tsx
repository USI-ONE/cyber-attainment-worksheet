import Link from 'next/link';
import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser, canAccessTenant } from '@/lib/auth';
import MarkdownView from '@/components/MarkdownView';
import DownloadClient from '@/components/DocumentDownloadButton';

/**
 * /plans/[code]/view — inline viewer for the document currently attached
 * to one plans-library entry on the current tenant. Resolves the active
 * plan_document_id from tenant_plans, fetches the bytes from Storage,
 * and renders:
 *
 *   - text/markdown, text/plain  → MarkdownView (client component)
 *   - application/pdf            → <iframe> pointing at the inline
 *                                  /api/policy-documents/[id]/content
 *                                  route, so the PDF renders in-place
 *   - everything else            → graceful fallback with a download
 *                                  link, because not every type is
 *                                  inline-viewable in a browser
 *
 * Tenant-scoped via canAccessTenant.
 */
export const dynamic = 'force-dynamic';
const BUCKET = 'policy-documents';

export default async function PlanViewPage({
  params,
}: {
  params: { code: string };
}) {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) {
    return <main className="app-main"><div className="banner error">No tenant.</div></main>;
  }

  const cu = await getCurrentUser();
  if (!canAccessTenant(cu, tenant.id)) {
    return <main className="app-main"><div className="banner error">You don&apos;t have access to this tenant.</div></main>;
  }

  const sb = createServiceRoleClient();

  // Catalog row gives us the human-readable plan name.
  const { data: cat } = await sb
    .from('plans_library_catalog')
    .select('code, title, category, description')
    .eq('code', params.code)
    .maybeSingle();
  if (!cat) {
    return <NotFound tenantSlug={tenant.slug} code={params.code} reason="Unknown plan code." />;
  }

  const { data: tp } = await sb
    .from('tenant_plans')
    .select('plan_document_id, status, version, last_reviewed_at, next_review_due')
    .eq('tenant_id', tenant.id)
    .eq('plan_code', params.code)
    .maybeSingle();

  if (!tp?.plan_document_id) {
    return <NotFound tenantSlug={tenant.slug} code={params.code}
      reason="No document is attached to this plan yet. Upload one from the Plans Library to make it viewable." />;
  }

  const { data: doc } = await sb
    .from('policy_documents')
    .select('id, title, version, effective_date, status, storage_path, filename, content_type, size_bytes')
    .eq('id', tp.plan_document_id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!doc) {
    return <NotFound tenantSlug={tenant.slug} code={params.code}
      reason="Linked document row could not be loaded." />;
  }

  const contentType = (doc.content_type ?? '').toLowerCase();
  const isMarkdown = contentType.startsWith('text/markdown') ||
                     contentType.startsWith('text/x-markdown') ||
                     /\.md$/i.test(doc.filename ?? '');
  const isPlain    = contentType.startsWith('text/plain') && !isMarkdown;
  const isPdf      = contentType.startsWith('application/pdf') ||
                     /\.pdf$/i.test(doc.filename ?? '');

  // For text-y bodies, fetch and pass to the client renderer.
  let body: string | null = null;
  if (isMarkdown || isPlain) {
    const { data: blob } = await sb.storage.from(BUCKET).download(doc.storage_path);
    if (blob) body = await blob.text();
  }

  return (
    <main className="app-main">
      <Header
        planTitle={cat.title}
        category={cat.category}
        doc={{
          id: doc.id,
          title: doc.title,
          version: doc.version ?? tp.version ?? null,
          effective_date: doc.effective_date,
          last_reviewed_at: tp.last_reviewed_at,
          next_review_due: tp.next_review_due,
          filename: doc.filename ?? null,
          content_type: doc.content_type ?? null,
          size_bytes: doc.size_bytes ?? null,
        }}
      />

      <section className="scorecard" style={{ marginTop: 16, padding: 24 }}>
        {isMarkdown && body !== null && <MarkdownView source={body} />}

        {isPlain && body !== null && (
          <pre style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 12.5,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
          }}>{body}</pre>
        )}

        {isPdf && (
          <iframe
            src={`/api/policy-documents/${doc.id}/content`}
            title={doc.title}
            style={{ width: '100%', height: '85vh', border: '1px solid var(--bg-border)', borderRadius: 4 }}
          />
        )}

        {!isMarkdown && !isPlain && !isPdf && (
          <FallbackUnviewable docId={doc.id} filename={doc.filename ?? 'document'} />
        )}
      </section>
    </main>
  );
}

function Header({
  planTitle, category, doc,
}: {
  planTitle: string;
  category: string;
  doc: {
    id: string;
    title: string;
    version: string | null;
    effective_date: string | null;
    last_reviewed_at: string | null;
    next_review_due: string | null;
    filename: string | null;
    content_type: string | null;
    size_bytes: number | null;
  };
}) {
  return (
    <section className="scorecard">
      <div className="scorecard-header">
        <div>
          <div className="scorecard-title">{doc.title}</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            {planTitle} · {category} · v{doc.version ?? '—'}
            {doc.effective_date && <> · effective {doc.effective_date}</>}
            {doc.last_reviewed_at && <> · last reviewed {doc.last_reviewed_at}</>}
            {doc.next_review_due && <> · next due {doc.next_review_due}</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="action-btn" href={'/plans' as never}>← Back to Plans Library</Link>
          {/* The /content endpoint serves inline; the /document download
              endpoint forces a save dialog. Both available from here. */}
          <DownloadButton docId={doc.id} />
        </div>
      </div>
    </section>
  );
}

function DownloadButton({ docId }: { docId: string }) {
  return <DownloadClient docId={docId} />;
}

function FallbackUnviewable({ docId, filename }: { docId: string; filename: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
      <div style={{ fontSize: 14, color: 'var(--text-mid)', marginBottom: 6 }}>
        This document type isn&apos;t viewable inline in the browser.
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        ({filename})
      </div>
      <DownloadClient docId={docId} label="Download to view" />
    </div>
  );
}

function NotFound({ tenantSlug, code, reason }: { tenantSlug: string; code: string; reason: string }) {
  void tenantSlug; void code;
  return (
    <main className="app-main">
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Plan not viewable</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>{reason}</div>
          </div>
          <Link className="action-btn" href={'/plans' as never}>← Back to Plans Library</Link>
        </div>
      </section>
    </main>
  );
}
