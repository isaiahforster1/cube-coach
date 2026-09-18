import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  createRandomStateScrambleProvider,
  DEFAULT_TIMER_CONFIG,
  formatSolve,
  type Penalty,
  type Scramble,
} from '@cube-coach/shared';
import { useLogout, useSession } from '../auth/use-session.js';
import { TimerDisplay } from './TimerDisplay.js';
import { useTimer, type SolveResult } from './use-timer.js';

const scrambles = createRandomStateScrambleProvider();

export function TimerPage(): ReactElement {
  const { data: user } = useSession();
  const logout = useLogout();

  const [inspectionEnabled, setInspectionEnabled] = useState(false);
  const [scramble, setScramble] = useState<Scramble | null>(null);
  const [lastSolve, setLastSolve] = useState<SolveResult | null>(null);

  const loadScramble = useCallback(() => {
    let cancelled = false;
    void scrambles.generate().then((next) => {
      if (!cancelled) setScramble(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => loadScramble(), [loadScramble]);

  const timer = useTimer({
    config: { ...DEFAULT_TIMER_CONFIG, inspectionEnabled },
    onSolveComplete: useCallback(
      (result: SolveResult) => {
        // M7 persists this. For now it stays on screen so the timer is usable on its own.
        setLastSolve(result);
        // Fetch the next scramble immediately, so it is on screen and ready before
        // the cuber reaches for the spacebar again.
        loadScramble();
      },
      [loadScramble],
    ),
  });

  function applyPenalty(penalty: Penalty): void {
    timer.setPenalty(penalty);
    setLastSolve((previous) => (previous === null ? null : { ...previous, penalty }));
  }

  function nextSolve(): void {
    timer.reset();
    loadScramble();
  }

  const finished = timer.phase === 'stopped';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">CubeCoach</h1>
          <p className="text-sm text-slate-500">{user?.displayName}</p>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={inspectionEnabled}
              onChange={(event) => setInspectionEnabled(event.target.checked)}
              className="size-4"
            />
            Inspection
          </label>

          <button
            type="button"
            onClick={() => logout.mutate()}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </header>

      <p className="mt-10 text-center font-mono text-lg break-words text-slate-700">
        {scramble?.notation ?? 'Generating scramble…'}
      </p>

      {/*
        The timer surface. `touch-none` stops the browser treating a press as the start
        of a scroll or a pinch, which would otherwise swallow the event on a phone.
      */}
      <section
        {...timer.surfaceProps}
        className="flex flex-1 touch-none items-center justify-center py-16 select-none"
      >
        <TimerDisplay
          phase={timer.phase}
          displayMs={timer.displayMs}
          penalty={timer.penalty}
          inspectionRemainingMs={timer.inspectionRemainingMs}
        />
      </section>

      <footer className="min-h-24">
        {finished && lastSolve !== null ? (
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-2">
              <PenaltyButton
                label="+2"
                active={timer.penalty === 'plus2'}
                onClick={() => applyPenalty(timer.penalty === 'plus2' ? 'none' : 'plus2')}
              />
              <PenaltyButton
                label="DNF"
                active={timer.penalty === 'dnf'}
                onClick={() => applyPenalty(timer.penalty === 'dnf' ? 'none' : 'dnf')}
              />
              <button
                type="button"
                onClick={nextSolve}
                className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
              >
                Next scramble
              </button>
            </div>

            <p className="text-sm text-slate-500">
              Recorded {formatSolve(lastSolve.durationMs, timer.penalty)} — not yet saved.
            </p>
          </div>
        ) : (
          <p className="text-center text-sm text-slate-400">
            {inspectionEnabled
              ? 'Press space to begin inspection, then hold to start.'
              : 'Hold space, release to start.'}
          </p>
        )}
      </footer>
    </main>
  );
}

function PenaltyButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={(event) => {
        onClick();
        // Drop focus, so the next spacebar press starts a solve instead of pressing
        // this button again.
        event.currentTarget.blur();
      }}
      aria-pressed={active}
      className={`rounded-md border px-4 py-1.5 text-sm font-medium ${
        active
          ? 'border-amber-500 bg-amber-50 text-amber-800'
          : 'border-slate-300 text-slate-700 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );
}
