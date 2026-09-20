import type { ReactElement, ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { useLogout, useSession } from '../features/auth/use-session.js';
import { GuestMigrationNotice } from '../features/guest/GuestMigrationNotice.js';

/**
 * Shared chrome for every page.
 *
 * `fillsViewport` is for pages that want the space rather than merely occupying it —
 * the timer, whose press surface should be the whole screen and not a band in the
 * middle of it. It makes the content area a flex column of exactly the height that is
 * left, so a child can claim it with `flex-1`.
 */
export function AppLayout({
  children,
  fillsViewport = false,
}: {
  children: ReactNode;
  fillsViewport?: boolean;
}): ReactElement {
  const { data: user, isPending } = useSession();
  const logout = useLogout();

  return (
    /*
      `min-h-dvh`, not `min-h-screen`. On a phone `100vh` is the height of the viewport
      with the address bar hidden, which is taller than what you can actually see — so
      every page is born a little too long and scrolls slightly no matter what is on it.
      `dvh` tracks the visible height as the bar comes and goes.
    */
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
          <h1 className="shrink-0 text-lg font-semibold text-slate-900">CubeCoach</h1>

          {/*
            A <nav> landmark so assistive technology can jump straight to it. NavLink sets
            aria-current on the active link, which is how a screen reader announces which
            page you are on.

            It scrolls sideways rather than wrapping or squeezing: five destinations do
            not fit across a phone, and a nav that wraps onto a second line steals height
            from the timer on the one screen where height is the whole point.
          */}
          <nav
            aria-label="Main"
            className="flex min-w-0 gap-4 overflow-x-auto text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
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
            className="shrink-0 text-sm whitespace-nowrap text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
          >
            Sign in
          </Link>
        ) : (
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-slate-500 sm:inline">{user.displayName}</span>
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

      <div className={`flex-1 pt-6 sm:pt-8 ${fillsViewport ? 'flex flex-col' : ''}`}>
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
