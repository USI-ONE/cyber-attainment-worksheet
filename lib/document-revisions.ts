/**
 * Shared revision helpers for policy_documents.
 *
 * Both the Plans Library and the Policy Library write into the same
 * policy_documents table; both want the same "edit creates a new
 * version" semantics. This module centralizes:
 *
 *   - bumpVersion(prev)       — string version bumper ("1.0" → "1.1")
 *   - createRevision(...)     — upload new bytes, insert new doc row,
 *                                archive prior, set lineage_id + change_note
 *   - listLineage(supabase,…) — fetch all versions in lineage for a tenant
 *
 * The route handler is still responsible for repointing whatever
 * linking row (tenant_plans.plan_document_id / tenant_policies.policy_document_id)
 * pointed at the prior version.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PolicyDocument } from '@/lib/supabase/types';

const BUCKET = 'policy-documents';

/**
 * Bump a version string. Conservative rules — works on the common
 * shapes we actually use ("1.0", "1.2", "2025-Q3") without trying to
 * be a SemVer engine:
 *
 *   "1.0"     → "1.1"
 *   "1.9"     → "1.10"
 *   "2.0.5"   → "2.0.6"
 *   "1"       → "1.1"
 *   "draft"   → "draft.1"
 *   anything that doesn't end in a number → suffix ".1"
 *
 * Caller can always override with an explicit version label.
 */
export function bumpVersion(prev: string | null | undefined): string {
  if (!prev || !prev.trim()) return '1.1';
  const trimmed = prev.trim();
  const m = trimmed.match(/^(.*?)(\d+)$/);
  if (!m) return `${trimmed}.1`;
  const [, head, last] = m;
  const next = String(parseInt(last, 10) + 1);
  return `${head}${next}`;
}

/**
 * Create a new revision of an existing policy_documents row by writing
 * new content into Storage and inserting a fresh row that shares the
 * prior row's lineage_id. Archives the prior row and points it at the
 * new one via superseded_by.
 *
 * Returns the inserted row. Caller updates the linking table.
 */
export async function createRevision(
  supabase: SupabaseClient,
  args: {
    priorDoc: Pick<PolicyDocument,
      'id' | 'tenant_id' | 'title' | 'lineage_id' | 'policy_code' | 'linked_control_ids'>;
    newContent: Uint8Array | Blob | string;
    contentType: string;
    filenameHint?: string;
    newVersion?: string | null;
    changeNote?: string | null;
    editedBy?: string | null;
  },
): Promise<{ doc: PolicyDocument; rollback: () => Promise<void> }> {
  const { priorDoc } = args;

  // Encode content uniformly to a Blob with explicit type so the
  // storage upload + size accounting are consistent across input shapes.
  let blob: Blob;
  if (typeof args.newContent === 'string') {
    blob = new Blob([args.newContent], { type: args.contentType });
  } else if (args.newContent instanceof Blob) {
    blob = args.newContent;
  } else {
    // Uint8Array — copy into a fresh ArrayBuffer-backed view so the
    // Blob constructor type-checks cleanly under strict DOM lib settings.
    blob = new Blob([new Uint8Array(args.newContent)], { type: args.contentType });
  }

  const today = new Date().toISOString().slice(0, 10);
  const newDocId = crypto.randomUUID();
  const filename = args.filenameHint || `${priorDoc.title.replace(/[^a-z0-9._-]+/gi, '_')}.md`;
  const storagePath = `${priorDoc.tenant_id}/${newDocId}/${crypto.randomUUID()}-${filename}`;

  const upload = await supabase.storage.from(BUCKET).upload(storagePath, blob, {
    contentType: args.contentType,
    upsert: false,
  });
  if (upload.error) {
    throw new Error(`storage upload failed: ${upload.error.message}`);
  }

  // Pre-build the rollback so callers can use it on later failures
  // (e.g. linking-table update fails after we've already inserted).
  const rollback = async () => {
    await supabase.storage.from(BUCKET).remove([storagePath]);
  };

  const inserted = await supabase
    .from('policy_documents')
    .insert({
      id: newDocId,
      tenant_id: priorDoc.tenant_id,
      title: priorDoc.title,
      version: args.newVersion ?? bumpVersion(null),
      effective_date: today,
      status: 'published',
      description: args.changeNote ?? null,
      storage_path: storagePath,
      filename,
      content_type: args.contentType,
      size_bytes: blob.size,
      uploaded_by: args.editedBy ?? null,
      linked_control_ids: priorDoc.linked_control_ids ?? [],
      policy_code: priorDoc.policy_code ?? null,
      lineage_id: priorDoc.lineage_id ?? priorDoc.id,
      change_note: args.changeNote ?? null,
    })
    .select('*')
    .single();

  if (inserted.error || !inserted.data) {
    await rollback();
    throw new Error(inserted.error?.message ?? 'insert failed');
  }

  // Archive the prior row + point it at this one.
  await supabase
    .from('policy_documents')
    .update({ status: 'archived', superseded_by: newDocId })
    .eq('id', priorDoc.id);

  return { doc: inserted.data as PolicyDocument, rollback };
}

/**
 * Return all versions of a document lineage, newest first. Tenant-scoped
 * so cross-tenant ids can't leak history.
 */
export async function listLineage(
  supabase: SupabaseClient,
  args: { tenantId: string; lineageId: string },
): Promise<PolicyDocument[]> {
  const { data } = await supabase
    .from('policy_documents')
    .select('*')
    .eq('tenant_id', args.tenantId)
    .eq('lineage_id', args.lineageId)
    .order('created_at', { ascending: false });
  return (data ?? []) as PolicyDocument[];
}
