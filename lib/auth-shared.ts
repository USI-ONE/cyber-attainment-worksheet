/**
 * Edge-safe auth constants.
 *
 * This file is imported by middleware.ts which runs in Next.js's Edge
 * runtime. The Edge runtime cannot load node: APIs (node:crypto, etc.)
 * — and importing lib/auth.ts would transitively pull in scrypt /
 * randomBytes / timingSafeEqual, killing the middleware build.
 *
 * So anything middleware needs lives here as plain TypeScript primitives
 * with no Node-runtime imports. lib/auth.ts re-exports these names so
 * application code can keep importing from a single module.
 */

/** Cookie name used for the session token. Edge + Node both read this. */
export const SESSION_COOKIE_NAME = 'caw_session';

/** Session lifetime in days. New sessions expire this far out; an active
 *  session slides forward on each request (see lib/auth#getCurrentUser). */
export const SESSION_TTL_DAYS = 14;
