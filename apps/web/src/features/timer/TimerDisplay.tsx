import type { ReactElement } from 'react';
import { formatDuration, formatSolve, type Penalty, type TimerPhase } from '@cube-coach/shared';

export interface TimerDisplayProps {
  readonly phase: TimerPhase;
  readonly displayMs: number;
  readonly penalty: Penalty;
  readonly inspectionRemainingMs: number | undefined;
}

/** Colour tells you what the timer is doing before you have read anything. */
const PHASE_COLOUR: Record<TimerPhase, string> = {
  idle: 'text-slate-900',
  inspecting: 'text-amber-600',
  holding: 'text-red-600',
  ready: 'text-green-600',
  running: 'text-slate-900',
  stopped: 'text-slate-900',
};

export function TimerDisplay({
  phase,
  displayMs,
  penalty,
  inspectionRemainingMs,
}: TimerDisplayProps): ReactElement {
  const inspecting =
    phase === 'inspecting' || (phase === 'holding' && inspectionRemainingMs !== undefined);

  const text = inspecting
    ? formatInspection(inspectionRemainingMs ?? 0)
    : phase === 'stopped'
      ? formatSolve(displayMs, penalty)
      : formatDuration(displayMs);

  return (
    <div className="flex flex-col items-center gap-2">
      {/*
        Deliberately not a live region. A number changing sixty times a second would be
        announced continuously by a screen reader, which is unusable. The final result is
        announced once, separately, below.
      */}
      <p
        aria-hidden="true"
        className={`font-mono text-7xl font-light tabular-nums select-none sm:text-8xl ${PHASE_COLOUR[phase]}`}
      >
        {text}
      </p>

      <output className="sr-only">
        {phase === 'stopped' ? `Solve finished: ${formatSolve(displayMs, penalty)}` : ''}
      </output>
    </div>
  );
}

/**
 * Inspection counts down in whole seconds, then shows the penalty once it overruns —
 * a cuber needs to know they have crossed into +2 territory before starting, not after.
 */
function formatInspection(remainingMs: number): string {
  if (remainingMs > 0) return Math.ceil(remainingMs / 1000).toString();
  return remainingMs > -2_000 ? '+2' : 'DNF';
}
