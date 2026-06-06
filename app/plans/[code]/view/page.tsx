import Link from 'next/link';
import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser, canAccessTenant, canEditTenant } from '@/lib/auth';
import PlanDocumentEditor from '@/components/PlanDocumentEditor';
import DownloadClient from '@/components/DocumentDownloadButton';

/**
 * /plans/[code]/view — inline viewer for the document attached to one
 * plans-library entry on the current tenant.
 *
 * Default: resolves the *current* plan_document_id from tenant_plans
 * and renders it.
 * With `?v=<docId>`: renders that specific historical version instead.
 *   The version still has to belong to this tenant, and we trust the
 *   client component to display a "viewing historical revision" banner.
 *
 * Render mode by content type:
 *   - text/markdown, text/plain → PlanDocumentEditor (read / edit / history)
 *   - application/pdf           → <iframe> pointing at the inline content
 *                                 endpoint
 *   - everything else           → graceful fallback + download CTA
 *
 * Tenant-scoped via canAccessTenant. Edit mode is gated by canEditTenant.
 */
export const dynamic = 'force-dynamic';
const BUCKET = 'policy-documents';

export default async function PlanViewPage({
  params, searchParams,
}: {
  params: { code: string };
  searchParams?: { v?: string };
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
  const canEdit = canEditTenant(cu, tenant.id);

  const sb = createServiceRoleClient();

  // Catalog row gives us the human-readable plan name.
  const { data: cat } = await sb
    .from('plans_library_catalog')
    .select('code, title, category, description')
    .eq('code', params.code)
    .maybeSingle();
  if (!cat) {
    return <NotFound reason="Unknown plan code." />;
  }

  // Current tenant_plans row tells us the *current* doc id.
  const { data: tp } = await sb
    .from('tenant_plans')
    .select('plan_document_id, status, version, last_reviewed_at, next_review_due')
    .eq('tenant_id', tenant.id)
    .eq('plan_code', params.code)
    .maybeSingle();

  if (!tp?.plan_document_id) {
    return <NotFound
      reason="No document is attached to this plan yet. Upload one from the Plans Library to make it viewable." />;
  }

  // Which document are we actually rendering? Default: the current one.
  // If ?v=<id> is supplied, render that historical version instead, but
  // only after verifying it belongs to this tenant AND the same lineage
  // as the current doc (no cross-plan id swapping).
  const viewingId = searchParams?.v;
  let docId = tp.plan_document_id;
  if (viewingId && viewingId !== tp.plan_document_id) {
    // Lookup the requested historical doc — must share lineage with current.
    const [{ data: current }, { data: requested }] = await Promise.all([
      sb.from('policy_documents').select('lineage_id').eq('id', tp.plan_document_id).eq('tenant_id', tenant.id).maybeSingle(),
      sb.from('policy_documents').select('id, lineage_id').eq('id', viewingId).eq('tenant_id', tenant.id).maybeSingle(),
    ]);
    if (requested?.lineage_id && current?.lineage_id && requested.lineage_id === current.lineage_id) {
      docId = requested.id;
    }
  }

  const { data: doc } = await sb
    .from('policy_documents')
    .select('id, title, version, effective_date, status, storage_path, filename, content_type, size_bytes')
    .eq('id', docId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!doc) {
    return <NotFound reason="Linked document row could not be loaded." />;
  }

  const contentType = (doc.content_type ?? '').toLowerCase();
  const isMarkdown = contentType.startsWith('text/markdown') ||
                     contentType.startsWith('text/x-markdown') ||
                     /\.md$/i.test(doc.filename ?? '');
  const isPlain    = contentType.startsWith('text/plain') && !isMarkdown;
  const isPdf      = contentType.startsWith('application/pdf') ||
                     /\.pdf$/i.test(doc.filename ?? '');

  // For text-y bodies, fetch and pass to the client renderer/editor.
  let body: string | null = null;
  if (isMarkdown || isPlain) {
    const { data: blob } = await sb.storage.from(BUCKET).download(doc.storage_path);
    if (blob) body = await blob.text();
  }

  const docMeta = {
    id: doc.id,
    title: doc.title,
    version: doc.version ?? tp.version ?? null,
    effective_date: doc.effective_date,
    last_reviewed_at: tp.last_reviewed_at,
    next_review_due: tp.next_review_due,
  };

  return (
    <main className="app-main">
      <Header
        planTitle={cat.title}
        category={cat.category}
        currentDocId={tp.plan_document_id}
        doc={{
          ...docMeta,
          filename: doc.filename ?? null,
          content_type: doc.content_type ?? null,
          size_bytes: doc.size_bytes ?? null,
        }}
      />

      <section className="scorecard" style={{ marginTop: 16, padding: 24 }}>
        {isMarkdown && body !== null && (
          <PlanDocumentEditor
            code={params.code}
            planTitle={cat.title}
            doc={docMeta}
            initialBody={body}
            canEdit={canEdit}
            viewingId={viewingId ?? null}
          />
        )}

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
  planTitle, category, currentDocId, doc,
}: {
  planTitle: string;
  category: string;
  currentDocId: string;
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
  const viewingHistorical = doc.id !== currentDocId;
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
            {viewingHistorical && <> · <strong style={{ color: '#9A3412' }}>viewing historical revision</strong></>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="action-btn" href={'/plans' as never}>← Back to Plans Library</Link>
          <DownloadClient docId={doc.id} />
        </div>
      </div>
    </section>
  );
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

function NotFound({ reason }: { reason: string }) {
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
