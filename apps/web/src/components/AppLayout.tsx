import type { ReactElement, ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useLogout, useSession } from '../features/auth/use-session.js';

/** Shared chrome for the signed-in pages. */
export function AppLayout({ children }: { children: ReactNode }): ReactElement {
  const { data: user } = useSession();
  const logout = useLogout();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-semibold text-slate-900">CubeCoach</h1>

          {/*
            A <nav> landmark, so assistive technology can jump straight to it. NavLink
            sets aria-current on the active link, which is how a screen reader announces
            which page you are on.
          */}
          <nav aria-label="Main" className="flex gap-4 text-sm">
            <NavItem to="/">Timer</NavItem>
            <NavItem to="/history">History</NavItem>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-500">{user?.displayName}</span>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex-1 pt-8">{children}</div>
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
