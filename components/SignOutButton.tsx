'use client';

/**
 * Submits a POST to /api/auth/logout, which revokes the current session in
 * the DB and clears the cookie before redirecting to /auth/signin.
 */
export default function SignOutButton() {
  return (
    <form action="/api/auth/logout" method="post">
      <button type="submit" className="signout">Sign out</button>
    </form>
  );
}
