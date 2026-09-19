import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  createResilientScrambleProvider,
  DEFAULT_TIMER_CONFIG,
  formatSolve,
  type Penalty,
  type Scramble,
} from '@cube-coach/shared';
import { AppLayout } from '../../components/AppLayout.js';
import {
  useCurrentPracticeSession,
  useSaveSolve,
  useSolveSync,
  useUpdateSolvePenalty,
} from '../solves/use-solves.js';
import { useSolveStore } from '../solves/use-solve-store.js';
import { ScrambleView } from '../scramble/ScrambleView.js';
import { TimerDisplay } from './TimerDisplay.js';
import { useTimer, type SolveResult } from './use-timer.js';

const scrambles = createResilientScrambleProvider();

export function TimerPage(): ReactElement {
  const { practiceSessionId } = useCurrentPracticeSession();
  const saveSolve = useSaveSolve();
  const updatePenalty = useUpdateSolvePenalty();
  const { pendingCount, isSyncing } = useSolveSync();
  const { isGuest } = useSolveStore();

  const [inspectionEnabled, setInspectionEnabled] = useState(false);
  const [scramble, setScramble] = useState<Scramble | null>(null);
  const [lastSolve, setLastSolve] = useState<(SolveResult & { id: string }) | null>(null);

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

  const handleSolveComplete = useCallback(
    (result: SolveResult) => {
      const id = crypto.randomUUID();
      setLastSolve({ ...result, id });

      // The scramble is captured as it was when this solve started — the next one is
      // already being fetched by the time this runs.
      if (practiceSessionId !== undefined && scramble !== null) {
        saveSolve.mutate({
          id,
          practiceSessionId,
          scramble: scramble.notation,
          durationMs: result.durationMs,
          penalty: result.penalty,
          solvedAt: new Date().toISOString(),
          comment: null,
        });
      }

      loadScramble();
    },
    [practiceSessionId, scramble, saveSolve, loadScramble],
  );

  const timer = useTimer({
    config: useMemo(() => ({ ...DEFAULT_TIMER_CONFIG, inspectionEnabled }), [inspectionEnabled]),
    onSolveComplete: handleSolveComplete,
  });

  function applyPenalty(penalty: Penalty): void {
    timer.setPenalty(penalty);
    if (lastSolve === null) return;

    setLastSolve({ ...lastSolve, penalty });
    updatePenalty.mutate({ id: lastSolve.id, penalty });
  }

  /**
   * Changing the mode starts again from idle.
   *
   * Without this, toggling inspection mid-countdown leaves the machine inspecting
   * under rules that no longer apply — a state nothing else in the app expects.
   */
  const { reset } = timer;
  useEffect(() => {
    reset();
  }, [inspectionEnabled, reset]);

  const finished = timer.phase === 'stopped';

  return (
    <AppLayout>
      <div className="flex flex-col">
        <div className="flex items-center justify-end">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={inspectionEnabled}
              onChange={(event) => {
                setInspectionEnabled(event.target.checked);
                /**
                 * Hand the spacebar straight back to the timer.
                 *
                 * Clicking a checkbox focuses it, and a focused checkbox owns the space
                 * key — so the next press toggles the setting again instead of starting
                 * a solve. The setting flickers on and off, no countdown ever appears,
                 * and nothing about it suggests what is wrong.
                 */
                event.target.blur();
              }}
              className="size-4"
            />
            Inspection
          </label>
        </div>

        <div className="mt-6">
          <ScrambleView scramble={scramble} />
        </div>

        {/*
          `touch-none` stops the browser treating a press as the start of a scroll or a
          pinch, which would otherwise swallow the event on a phone.
        */}
        <section
          {...timer.surfaceProps}
          className="flex touch-none items-center justify-center py-20 select-none"
        >
          <TimerDisplay
            phase={timer.phase}
            displayMs={timer.displayMs}
            penalty={timer.penalty}
            inspectionRemainingMs={timer.inspectionRemainingMs}
          />
        </section>

        <div className="min-h-24">
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
              </div>

              <p className="text-sm text-slate-500">
                {formatSolve(lastSolve.durationMs, timer.penalty)} ·{' '}
                <SaveStatus
                  isGuest={isGuest}
                  isSaving={saveSolve.isPending}
                  failed={saveSolve.isError}
                  pendingCount={pendingCount}
                />
              </p>
            </div>
          ) : (
            <p className="text-center text-sm text-slate-400">
              {inspectionEnabled
                ? 'Press space to begin inspection, then hold to start.'
                : 'Hold space, release to start.'}
            </p>
          )}

          {/*
            Never claim a solve is safe when it exists only in this browser. A reassuring
            tick over unsaved data is worse than an honest warning.
          */}
          {pendingCount > 0 && !finished && (
            <p className="mt-2 text-center text-sm text-amber-700" role="status">
              {isSyncing
                ? `Saving ${pendingCount} solve${pendingCount === 1 ? '' : 's'}…`
                : `${pendingCount} solve${pendingCount === 1 ? '' : 's'} waiting to sync`}
            </p>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function SaveStatus({
  isGuest,
  isSaving,
  failed,
  pendingCount,
}: {
  isGuest: boolean;
  isSaving: boolean;
  failed: boolean;
  pendingCount: number;
}): ReactElement {
  if (isSaving) return <span className="text-slate-400">saving…</span>;

  // A guest's solves really are only in this browser. Saying "saved" in green would be
  // technically true and practically misleading — they will not be there on another
  // device, and finding that out later is exactly the surprise worth avoiding.
  if (isGuest) return <span className="text-slate-500">saved on this device</span>;

  if (failed || pendingCount > 0) {
    return <span className="text-amber-700">saved on this device only</span>;
  }
  return <span className="text-green-700">saved</span>;
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
        // Drop focus, so the next spacebar press starts a solve instead of pressing this
        // button again.
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
