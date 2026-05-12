/**
 * Read-only banner shown to signed-in users who do NOT have edit rights on
 * the current tenant (viewers + signed-in users with no membership). The
 * banner is a sibling of the API-level guards in lib/auth-api: the API
 * blocks writes server-side, this banner tells the user why their edit
 * controls don't work and the matching CSS rules in globals.css visually
 * dim the input fields so they don't even look interactive.
 */

import type { Tenant } from '@/lib/supabase/types';
import type { CurrentUser } from '@/lib/auth';

export default function ReadOnlyBanner({
  tenant, currentUser,
}: {
  tenant: Tenant;
  currentUser: CurrentUser;
}) {
  const membership = currentUser.memberships.find((m) => m.tenant_id === tenant.id);
  const reason = membership
    ? `You are signed in as a ${membership.role} for ${tenant.display_name}. Viewer access is read-only.`
    : `You are signed in but have no role on ${tenant.display_name}. Editing is disabled.`;

  return (
    <div style={{
      position: 'sticky',
      top: 140,
      zIndex: 50,
      margin: '0 auto 12px',
      maxWidth: 1700,
      padding: '10px 16px',
      background: 'rgba(245,158,11,0.10)',
      borderLeft: '3px solid #F59E0B',
      borderRadius: 'var(--r-md)',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      fontSize: 12,
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: '50%',
        background: '#F59E0B', color: '#fff', fontWeight: 700, fontSize: 13,
        flexShrink: 0,
      }}>i</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>Read-only mode</div>
        <div style={{ color: 'var(--text-mid)', marginTop: 2 }}>
          {reason} Ask an editor or platform admin to grant you the editor role
          if you need to make changes.
        </div>
      </div>
    </div>
  );
}
