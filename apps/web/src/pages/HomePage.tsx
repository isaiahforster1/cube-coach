import { useEffect, useState, type ReactElement } from 'react';
import { createRandomStateScrambleProvider, type Scramble } from '@cube-coach/shared';
import { useLogout, useSession } from '../features/auth/use-session.js';

const scrambles = createRandomStateScrambleProvider();

/**
 * A placeholder for the timer, which arrives in M6.
 *
 * It exists now to prove the whole stack is connected: the session comes from the API
 * over a cross-origin cookie, and the scramble comes from the shared package running
 * the WebAssembly solver in the browser.
 */
export function HomePage(): ReactElement {
  const { data: user } = useSession();
  const logout = useLogout();
  const [scramble, setScramble] = useState<Scramble | null>(null);

  useEffect(() => {
    let cancelled = false;

    void scrambles.generate().then((next) => {
      // Guard against setting state after unmount, which happens routinely in
      // development because React runs effects twice to surface exactly this bug.
      if (!cancelled) setScramble(next);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-10">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">CubeCoach</h1>
          <p className="text-sm text-slate-500">Signed in as {user?.displayName}</p>
        </div>

        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-slate-300 disabled:opacity-60"
        >
          Sign out
        </button>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-medium tracking-wide text-slate-500 uppercase">
          Scramble
        </h2>

        {scramble === null ? (
          <output className="text-slate-400">Generating…</output>
        ) : (
          <p className="font-mono text-lg break-words text-slate-900">{scramble.notation}</p>
        )}
      </section>

      <p className="mt-8 text-sm text-slate-500">The timer arrives in the next milestone.</p>
    </main>
  );
}
