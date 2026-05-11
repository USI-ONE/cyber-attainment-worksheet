/**
 * Standalone user-management & authentication for Cyber Attainment Worksheet.
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
import type { SupabaseClient } from '@supabase/supabase-js';

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
// Constants
// =============================================================================

export const SESSION_COOKIE_NAME = 'caw_session';
export const SESSION_TTL_DAYS    = 14;
const COOKIE_TTL_SECONDS         = SESSION_TTL_DAYS * 24 * 60 * 60;

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
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CawMembership {
  user_id: string;
  tenant_id: string;
  role: 'editor' | 'viewer';
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
      secure: isProduction(),
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
      secure: isProduction(),
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
    .select('id, email, display_name, is_platform_admin, status, last_login_at, created_at, updated_at')
    .eq('id', session.user_id)
    .maybeSingle();
  if (!user) return null;
  if (user.status !== 'active') return null;

  const { data: memberships } = await supabase
    .from('memberships')
    .select('user_id, tenant_id, role, created_at')
    .eq('user_id', user.id);

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
    user: user as CawUser,
    memberships: (memberships ?? []) as CawMembership[],
    session_id: session.id,
    session_expires_at: session.expires_at,
  };
}

// =============================================================================
// Guards / authorization helpers
// =============================================================================

export function canAccessTenant(cu: CurrentUser | null, tenantId: string): boolean {
  if (!cu) return false;
  if (cu.user.is_platform_admin) return true;
  return cu.memberships.some((m) => m.tenant_id === tenantId);
}

export function canEditTenant(cu: CurrentUser | null, tenantId: string): boolean {
  if (!cu) return false;
  if (cu.user.is_platform_admin) return true;
  return cu.memberships.some((m) => m.tenant_id === tenantId && m.role === 'editor');
}

/** Editors are also tenant admins for v1 — they can invite users to their
 *  tenant. If we later split admin from editor, change this to also check
 *  membership.role === 'admin'. */
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
  role: 'editor' | 'viewer' | null;
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
  role: 'editor' | 'viewer' | null;
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
