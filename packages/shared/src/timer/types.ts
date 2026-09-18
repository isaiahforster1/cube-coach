/**
 * A penalty applied to a solve, per competition rules.
 *
 * - `plus2` adds two seconds to the recorded time.
 * - `dnf` means the solve did not count. It is not a number, and it is treated as worse
 *   than any time — which matters when averages are calculated in M9.
 */
export type Penalty = 'none' | 'plus2' | 'dnf';

export const PLUS_TWO_PENALTY_MS = 2_000;

/**
 * Inspection rules: 15 seconds, then a grace band.
 *
 * Starting the solve between 15 and 17 seconds costs +2. After 17 seconds it is a DNF.
 * These are the actual WCA thresholds, not approximations.
 */
export const INSPECTION_DURATION_MS = 15_000;
export const INSPECTION_PLUS_TWO_LIMIT_MS = 17_000;

/**
 * Where the timer is in its cycle.
 *
 * - `idle` — showing a scramble, nothing running.
 * - `inspecting` — the 15-second countdown, when inspection is enabled.
 * - `holding` — a key or finger is down, but not yet long enough to start.
 * - `ready` — held long enough; releasing now starts the solve.
 * - `running` — timing.
 * - `stopped` — finished, with a result to record.
 */
export type TimerPhase = 'idle' | 'inspecting' | 'holding' | 'ready' | 'running' | 'stopped';

export interface TimerState {
  readonly phase: TimerPhase;
  /** When inspection began. Undefined when inspection is disabled or not started. */
  readonly inspectionStartedAt: number | undefined;
  readonly holdStartedAt: number | undefined;
  readonly solveStartedAt: number | undefined;
  readonly solveEndedAt: number | undefined;
  /** Set when the solve starts, from how long inspection actually took. */
  readonly penalty: Penalty;
}

export interface TimerConfig {
  readonly inspectionEnabled: boolean;
  /**
   * How long the key must be held before releasing starts the solve.
   *
   * This exists so that the finger is already still when timing begins — without it,
   * every solve would include the moment of reaching for the key. 550ms is the Stackmat
   * value that competition timers use, so muscle memory transfers.
   */
  readonly holdDurationMs: number;
}

export const DEFAULT_TIMER_CONFIG: TimerConfig = {
  inspectionEnabled: false,
  holdDurationMs: 550,
};

/**
 * Everything that can happen to the timer.
 *
 * Every event carries `at` — the current time — rather than the reducer reading a clock.
 * That is what keeps it a pure function: the same state and the same event always give
 * the same result, so tests can drive it through an entire solve without waiting a
 * single real millisecond.
 */
export type TimerEvent =
  | { readonly type: 'pressDown'; readonly at: number }
  | { readonly type: 'pressUp'; readonly at: number }
  | { readonly type: 'tick'; readonly at: number }
  | { readonly type: 'cancel' }
  | { readonly type: 'reset' }
  | { readonly type: 'setPenalty'; readonly penalty: Penalty };
