/**
 * Read-only banner — shown above main content for signed-in users who
 * have no edit rights on the current tenant. Non-sticky on purpose: it
 * scrolls away with the page rather than hovering over content the user
 * is trying to read. The persistent indicator is the role pill in the
 * Header user chip (always visible).
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
    ? `You have ${membership.role} access on ${tenant.display_name}. Editing is disabled.`
    : `You are signed in but have no role on ${tenant.display_name}. Editing is disabled.`;

  return (
    <div style={{
      maxWidth: 1700,
      margin: '12px auto 0',
      padding: '8px 14px 8px 12px',
      background: 'rgba(245,158,11,0.08)',
      borderLeft: '3px solid #F59E0B',
      borderRadius: 'var(--r-md)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 12,
      color: 'var(--text-mid)',
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 18, height: 18, borderRadius: '50%',
        background: '#F59E0B', color: '#fff', fontWeight: 700, fontSize: 11,
        flexShrink: 0, lineHeight: 1,
      }}>i</span>
      <span><strong style={{ color: 'var(--text)' }}>Read-only:</strong> {reason}</span>
    </div>
  );
}
