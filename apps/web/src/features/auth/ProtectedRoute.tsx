import type { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useSession } from './use-session.js';

/**
 * Gate for routes that require a signed-in user.
 *
 * The loading state matters more than it looks. Rendering the redirect while the
 * session is still being fetched would bounce every authenticated user to the login
 * page on a hard refresh, then bounce them back — a visible flicker and a lost
 * scroll position on every reload.
 */
export function ProtectedRoute(): ReactElement {
  const { data: user, isPending } = useSession();
  const location = useLocation();

  if (isPending) {
    return (
      <output className="flex min-h-screen items-center justify-center text-slate-500">
        Loading…
      </output>
    );
  }

  if (user === null || user === undefined) {
    // Remember where they were headed, so signing in returns them there rather than
    // dumping them on the home page.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
