import type { ReactElement, ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { useLogout, useSession } from '../features/auth/use-session.js';
import { GuestMigrationNotice } from '../features/guest/GuestMigrationNotice.js';

/** Shared chrome for every page. */
export function AppLayout({ children }: { children: ReactNode }): ReactElement {
  const { data: user, isPending } = useSession();
  const logout = useLogout();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-semibold text-slate-900">CubeCoach</h1>

          {/*
            A <nav> landmark so assistive technology can jump straight to it. NavLink sets
            aria-current on the active link, which is how a screen reader announces which
            page you are on.
          */}
          <nav aria-label="Main" className="flex gap-4 text-sm">
            <NavItem to="/">Timer</NavItem>
            <NavItem to="/history">History</NavItem>
            <NavItem to="/stats">Stats</NavItem>
            <NavItem to="/algorithms">Algorithms</NavItem>
            <NavItem to="/cube">Cube</NavItem>
          </nav>
        </div>

        {isPending ? null : user === null || user === undefined ? (
          /*
            Deliberately understated: a plain link, no badge, no banner, no modal on
            arrival. Someone who wants to try a timer should be able to try a timer. The
            account is there for the moment they decide their solves are worth keeping,
            and until then nagging about it only gets in the way.
          */
          <Link
            to="/login"
            className="text-sm text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
          >
            Sign in
          </Link>
        ) : (
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-500">{user.displayName}</span>
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 pt-8">
        <GuestMigrationNotice />
        {children}
      </div>
    </div>
  );
}

function NavItem({ to, children }: { to: string; children: ReactNode }): ReactElement {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        isActive
          ? 'font-medium text-sky-700 underline underline-offset-4'
          : 'text-slate-600 hover:text-slate-900'
      }
    >
      {children}
    </NavLink>
  );
}
