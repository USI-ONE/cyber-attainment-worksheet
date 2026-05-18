/**
 * Standalone user-management & authentication for TrustOS.
 *
 * Design goals:
 *   - Zero external auth dependency: no Supabase Auth, no Clerk, no Auth0, no
 *     Entra. Just our own users + sessions + invites tables in Supabase
 *     Postgres, with cookie-based sessions.
 *   - Future SSO compatible: adding OIDC/SAML later is a column addition
 *     (auth_provider, external_subject) and a new login route, not a rewrite.
 *
 * Authorization model (two dimensions):
 *   - profiles.is_platform_admin — global super-admin flag (USI staff). When
 *     true, the user implicitly has access to every tenant and can
 *     administer users, tenants, and memberships across the platform.
 *   - memberships(user_id, tenant_id, role: 'editor' | 'viewer') — per-tenant
 *     role. editor = read/write + can invite users to this tenant. viewer =
 *     read-only.
 *
 * Session lifecycle:
 *   - Login: 32 random bytes → base64url cookie value. We store SHA-256(value)
 *     in sessions.token_hash so a DB leak does not yield live cookies.
 *   - On every request: hash the cookie, look up the session, check not
 *     revoked, refresh last_seen_at, slide expiry forward.
 *   - Logout: mark revoked_at; cookie cleared in the response.
 *   - Cookie is HttpOnly, Secure (in production), SameSite=Lax, Path=/.
 *     Cookie is scoped to the deploy's hostname — no cross-subdomain sharing.
 *
 * Bootstrap: db/migrations/0015 only ships the schema. The apply-0015.mjs
 * helper script generates a one-time token for the first platform admin and
 * prints the URL.
 */

import { cookies } from 'next/headers';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { SESSION_COOKIE_NAME, SESSION_TTL_DAYS } from '@/lib/auth-shared';
import type { SupabaseClient } from '@supabase/supabase-js';

// Re-export the Edge-safe constants so application code can keep importing
// everything from '@/lib/auth' in one place. Middleware MUST import these
// from '@/lib/auth-shared' directly to avoid pulling node:crypto into the
// Edge runtime bundle.
export { SESSION_COOKIE_NAME, SESSION_TTL_DAYS };

// Direct Promise wrapper for scrypt. We avoid util.promisify here because its
// generated types drop the optional `options` parameter, leaving us with a
// (password, salt, keylen) signature only. Hand-rolling the wrapper keeps
// the N/r/p tuning surface available.
function scrypt(
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N?: number; r?: number; p?: number; maxmem?: number } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

// =============================================================================
// Constants (SESSION_COOKIE_NAME + SESSION_TTL_DAYS live in lib/auth-shared
// so middleware can import them without dragging in node:crypto.)
// =============================================================================

const COOKIE_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

const SCRYPT_KEYLEN  = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

// =============================================================================
// Types
// =============================================================================

export interface CawUser {
  id: string;
  email: string;
  display_name: string | null;
  is_platform_admin: boolean;
  status: 'active' | 'disabled' | 'invited';
  /**
   * Forced password-change flag — true when an admin issued a temp-password
   * invite. The user must hit /auth/change-password before any other UI is
   * usable. Cleared by /api/me/password once they pick a real password.
   */
  password_must_change: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CawMembership {
  user_id: string;
  tenant_id: string;
  role: 'editor' | 'viewer' | 'admin';
  created_at: string;
}

export interface CurrentUser {
  user: CawUser;
  memberships: CawMembership[];
  session_id: string;
  session_expires_at: string;
}

// =============================================================================
// Password hashing — scrypt (built-in, no native deps)
// Storage format: scrypt$N$r$p$saltHex$hashHex
// =============================================================================

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 12) {
    throw new Error('password must be at least 12 characters');
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return [
    'scrypt',
    SCRYPT_OPTIONS.N, SCRYPT_OPTIONS.r, SCRYPT_OPTIONS.p,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join('$');
}

/**
 * Generate a single-use temporary password for the invite flow.
 *
 * Strict constraints:
 *   - 14 chars long (one over the 12 minimum hashPassword enforces, so the
 *     temp value can be typed out at the door without bumping into the floor)
 *   - Exactly one lowercase, one uppercase, one digit, one symbol
 *   - Symbol set picked to read clearly in an email or over a phone call:
 *     no l/I/1/0/O confusables and no characters that break URL encoding
 *     on the off-chance someone pastes it into a query string by accident
 *
 * Returns the cleartext password. Caller is responsible for hashing it,
 * persisting the hash, and getting the cleartext to the user once (the
 * admin/users response body + the invite email).
 */
export function generateTempPassword(): string {
  const LOWER = 'abcdefghjkmnpqrstuvwxyz';   // no i/l/o
  const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';   // no I/L/O
  const DIGIT = '23456789';                  // no 0/1
  const SYMBOL = '!@#$%&*-_=+';              // URL-safe, screen-friendly
  const ALL = LOWER + UPPER + DIGIT + SYMBOL;

  const pickFrom = (pool: string): string => {
    // randomBytes(1) gives a 0..255 byte; rejection-sampling out of the
    // pool length keeps the distribution uniform without modulo bias.
    while (true) {
      const b = randomBytes(1)[0];
      const max = Math.floor(256 / pool.length) * pool.length;
      if (b < max) return pool[b % pool.length];
    }
  };

  // Seed with one from each category to guarantee class coverage, then
  // fill the rest from the full pool.
  const chars: string[] = [
    pickFrom(LOWER), pickFrom(UPPER), pickFrom(DIGIT), pickFrom(SYMBOL),
  ];
  while (chars.length < 14) chars.push(pickFrom(ALL));

  // Fisher–Yates shuffle so the class-coverage seed doesn't betray
  // its positions to anyone reading the cleartext.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  const derived = await scrypt(password, salt, expected.length, { N, r, p });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// =============================================================================
// Token / cookie helpers
// =============================================================================

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

// =============================================================================
// Sessions
// =============================================================================

/** Issue a new session, set the cookie, and return the session row. */
export async function createSessionForUser(
  userId: string,
  meta?: { user_agent?: string | null; ip?: string | null },
  supabaseArg?: SupabaseClient,
): Promise<{ token: string; expires_at: string }> {
  const supabase = supabaseArg ?? createServiceRoleClient();
  const token = generateToken();
  const token_hash = hashToken(token);
  const expires_at = new Date(Date.now() + COOKIE_TTL_SECONDS * 1000).toISOString();

  const { error } = await supabase.from('sessions').insert({
    user_id: userId,
    token_hash,
    user_agent: meta?.user_agent ?? null,
    ip:         meta?.ip ?? null,
    expires_at,
  });
  if (error) throw new Error(`session insert failed: ${error.message}`);

  // Set the cookie on the response. The cookies() API in a Server Action /
  // Route Handler context allows .set() — callers can also pass the cookie
  // back themselves if they're rendering on the edge.
  try {
    cookies().set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      // Always Secure. Browsers exempt localhost from the Secure flag, so
      // local dev still works; deployed environments are always HTTPS-only.
      // The previous `isProduction()` check left a window where a dev build
      // running over HTTP could set a non-Secure session cookie.
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_TTL_SECONDS,
    });
  } catch {
    // setting from a Server Component is a no-op in Next 14; caller may set
    // the cookie via the route handler response. Ignore.
  }

  // Touch the user's last_login_at.
  await supabase
    .from('profiles')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', userId);

  return { token, expires_at };
}

/** Revoke the current session and clear the cookie. */
export async function destroyCurrentSession(): Promise<void> {
  const jar = cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const supabase = createServiceRoleClient();
    await supabase
      .from('sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', hashToken(token))
      .is('revoked_at', null);
  }
  try {
    cookies().set({
      name: SESSION_COOKIE_NAME,
      value: '',
      httpOnly: true,
      // Always Secure. Browsers exempt localhost from the Secure flag, so
      // local dev still works; deployed environments are always HTTPS-only.
      // The previous `isProduction()` check left a window where a dev build
      // running over HTTP could set a non-Secure session cookie.
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  } catch { /* same fallback as above */ }
}

// =============================================================================
// Current-user lookup
// =============================================================================

/** Read the session cookie, return the user + memberships, or null if no
 *  valid session. Slides the session expiry forward by refreshing
 *  last_seen_at — but only if the existing expiry is more than 1 day old
 *  to avoid hammering the DB on every request. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return getCurrentUserByToken(token);
}

export async function getCurrentUserByToken(token: string): Promise<CurrentUser | null> {
  const supabase = createServiceRoleClient();
  const token_hash = hashToken(token);

  const { data: session } = await supabase
    .from('sessions')
    .select('id, user_id, expires_at, last_seen_at, revoked_at')
    .eq('token_hash', token_hash)
    .maybeSingle();
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  const { data: user } = await supabase
    .from('profiles')
    .select('id, email, display_name, is_platform_admin, status, password_must_change, last_login_at, created_at, updated_at')
    .eq('id', session.user_id)
    .maybeSingle();
  if (!user) return null;
  if (user.status !== 'active') return null;

  const { data: memberships } = await supabase
    .from('memberships')
    .select('user_id, tenant_id, role, created_at')
    .eq('user_id', user.id);
  const memList = (memberships ?? []) as CawMembership[];

  // Admin-tenant elevation. Membership with role='admin' in a tenant
  // flagged is_admin_tenant=true confers effective platform-admin status.
  // Editor/viewer memberships in an admin tenant grant ONLY read access
  // to that tenant's data, not platform-wide admin — that's the bug-fix
  // that prompted migration 0023. Before this, ANY membership on the
  // admin tenant elevated; that turned out too coarse and surprised
  // operators who added a user as a viewer expecting read-only behavior.
  //
  // Non-admin tenants ignore role='admin' — it has no special meaning
  // outside an is_admin_tenant=true tenant today. The role exists as a
  // forward-compat slot for a future per-tenant admin tier.
  let effectiveIsPlatformAdmin = !!user.is_platform_admin;
  if (!effectiveIsPlatformAdmin && memList.length > 0) {
    const adminMems = memList.filter((m) => m.role === 'admin');
    if (adminMems.length > 0) {
      const tenantIds = adminMems.map((m) => m.tenant_id);
      const { data: adminTenants } = await supabase
        .from('tenants')
        .select('id')
        .eq('is_admin_tenant', true)
        .in('id', tenantIds);
      if ((adminTenants ?? []).length > 0) effectiveIsPlatformAdmin = true;
    }
  }

  // Sliding refresh: touch last_seen_at + slide expires_at forward by the
  // full TTL if it hasn't been touched in the last hour.
  const lastSeen = session.last_seen_at ? new Date(session.last_seen_at).getTime() : 0;
  if (Date.now() - lastSeen > 60 * 60 * 1000) {
    await supabase
      .from('sessions')
      .update({
        last_seen_at: new Date().toISOString(),
        expires_at:   new Date(Date.now() + COOKIE_TTL_SECONDS * 1000).toISOString(),
      })
      .eq('id', session.id);
  }

  return {
    user: { ...user, is_platform_admin: effectiveIsPlatformAdmin } as CawUser,
    memberships: memList,
    session_id: session.id,
    session_expires_at: session.expires_at,
  };
}

// =============================================================================
// Guards / authorization helpers
// =============================================================================

/**
 * Access model (current):
 *   - canAccessTenant — read access. Granted by any membership on that
 *     tenant (editor OR viewer) or by platform-admin status.
 *   - canEditTenant   — write access. Granted ONLY by platform-admin status.
 *     Tenant memberships do not confer edit. The 'editor' role still exists
 *     in the schema for future use (e.g., a per-tenant admin tier), but as
 *     of this commit it grants the same access as 'viewer': read-only.
 *   - canAdministerTenant — same as canEditTenant for now. User management
 *     remains platform-admin-only at the hub.
 *
 * Why the simplification: the platform is operated by a single MSP (USI).
 * Customers and their tenant users should be able to see their data, run
 * the assessment, view dashboards, and download reports — but the MSP
 * remains the editor of record. This avoids the surprise of one customer
 * accidentally rewriting another's scores or policies, and keeps the
 * blast radius of a compromised tenant credential tightly limited.
 *
 * A user becomes a "full admin" via either path:
 *   - profiles.is_platform_admin = true (per-user flag), OR
 *   - membership to any tenant flagged is_admin_tenant=true (e.g., USI)
 * Both paths are checked by isPlatformAdmin/getCurrentUserByToken and
 * collapse into the single cu.user.is_platform_admin boolean by the
 * time anything calls these helpers.
 */

export function canAccessTenant(cu: CurrentUser | null, tenantId: string): boolean {
  if (!cu) return false;
  if (cu.user.is_platform_admin) return true;
  return cu.memberships.some((m) => m.tenant_id === tenantId);
}

export function canEditTenant(cu: CurrentUser | null, _tenantId: string): boolean {
  if (!cu) return false;
  // Platform-admin-only. Tenant memberships grant read via canAccessTenant
  // but never write. The _tenantId param is retained for API symmetry —
  // callers were already passing it and we may want per-tenant write
  // restrictions back later. Suppress the unused-var lint with the
  // leading underscore prefix.
  return !!cu.user.is_platform_admin;
}

/** Same as canEditTenant today — administering a tenant (inviting users,
 *  managing settings) is platform-admin-only and happens at the hub. If a
 *  future "tenant admin" tier lands, change this to also accept that role. */
export function canAdministerTenant(cu: CurrentUser | null, tenantId: string): boolean {
  return canEditTenant(cu, tenantId);
}

export function isPlatformAdmin(cu: CurrentUser | null): boolean {
  return !!cu?.user.is_platform_admin;
}

// =============================================================================
// Invites
// =============================================================================

export interface InviteRecord {
  id: string;
  email: string;
  tenant_id: string | null;
  role: 'editor' | 'viewer' | 'admin' | null;
  grant_platform_admin: boolean;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  invited_by: string | null;
  created_at: string;
}

/** Issue an invite for an email, returning the cleartext token (to be shown
 *  to the inviting admin and copied/sent manually). The DB stores only the
 *  SHA-256 hash. */
export async function issueInvite(args: {
  email: string;
  invited_by: string | null;
  tenant_id: string | null;
  role: 'editor' | 'viewer' | 'admin' | null;
  grant_platform_admin: boolean;
  ttl_days?: number;
  supabase?: SupabaseClient;
}): Promise<{ token: string; invite: InviteRecord }> {
  const supabase = args.supabase ?? createServiceRoleClient();
  const token = generateToken();
  const token_hash = hashToken(token);
  const ttl = args.ttl_days ?? 14;
  const expires_at = new Date(Date.now() + ttl * 86400 * 1000).toISOString();

  // Revoke any prior pending invites for this email so we don't accumulate
  // dangling tokens. The unique partial index enforces only one active
  // invite per email anyway.
  await supabase
    .from('user_invites')
    .update({ revoked_at: new Date().toISOString() })
    .ilike('email', args.email)
    .is('accepted_at', null)
    .is('revoked_at', null);

  const { data, error } = await supabase
    .from('user_invites')
    .insert({
      email: args.email,
      invited_by: args.invited_by,
      tenant_id: args.tenant_id,
      role: args.role,
      grant_platform_admin: args.grant_platform_admin,
      token_hash,
      expires_at,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'invite insert failed');

  return { token, invite: data as InviteRecord };
}

/** Look up an invite by cleartext token. Returns null if not found, expired,
 *  accepted, or revoked. */
export async function findValidInvite(
  token: string,
  supabaseArg?: SupabaseClient,
): Promise<InviteRecord | null> {
  if (!token) return null;
  const supabase = supabaseArg ?? createServiceRoleClient();
  const { data } = await supabase
    .from('user_invites')
    .select('*')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (!data) return null;
  if (data.accepted_at) return null;
  if (data.revoked_at) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data as InviteRecord;
}

// =============================================================================
// Audit
// =============================================================================

export async function audit(args: {
  actor_id?: string | null;
  target_id?: string | null;
  tenant_id?: string | null;
  action: string;
  detail?: Record<string, unknown>;
  ip?: string | null;
  user_agent?: string | null;
  supabase?: SupabaseClient;
}): Promise<void> {
  const supabase = args.supabase ?? createServiceRoleClient();
  await supabase.from('audit_log_user').insert({
    actor_id:   args.actor_id ?? null,
    target_id:  args.target_id ?? null,
    tenant_id:  args.tenant_id ?? null,
    action:     args.action,
    detail:     args.detail ?? {},
    ip:         args.ip ?? null,
    user_agent: args.user_agent ?? null,
  });
}
