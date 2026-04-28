'use client';

export default function SignOutButton() {
  return (
    <form action="/api/auth/signout" method="post">
      <button type="submit" className="signout">Sign out</button>
    </form>
  );
}
