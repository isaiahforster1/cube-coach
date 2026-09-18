import {
  INSPECTION_DURATION_MS,
  INSPECTION_PLUS_TWO_LIMIT_MS,
  PLUS_TWO_PENALTY_MS,
  type Penalty,
  type TimerConfig,
  type TimerEvent,
  type TimerState,
} from './types.js';

export function createInitialState(): TimerState {
  return {
    phase: 'idle',
    inspectionStartedAt: undefined,
    holdStartedAt: undefined,
    solveStartedAt: undefined,
    solveEndedAt: undefined,
    penalty: 'none',
  };
}

/**
 * Which penalty an inspection of this length earns.
 *
 * Exported because the UI shows it live during the countdown — a cuber needs to know
 * they have crossed into +2 territory before they start, not afterwards.
 */
export function inspectionPenaltyFor(elapsedMs: number): Penalty {
  if (elapsedMs > INSPECTION_PLUS_TWO_LIMIT_MS) return 'dnf';
  if (elapsedMs > INSPECTION_DURATION_MS) return 'plus2';
  return 'none';
}

/**
 * The timer, as a pure function of state and event.
 *
 * Deliberately a reducer rather than a set of callbacks mutating variables. A timer has
 * a small number of states and strict rules about which transitions are legal, and
 * scattering that across event handlers is how timers end up able to start while already
 * running, or record a solve that never began.
 */
export function timerReducer(
  state: TimerState,
  event: TimerEvent,
  config: TimerConfig,
): TimerState {
  switch (event.type) {
    case 'reset':
      return createInitialState();

    /** Abandon whatever is in progress — used when the window loses focus. */
    case 'cancel':
      return state.phase === 'running' || state.phase === 'stopped' ? state : createInitialState();

    case 'setPenalty':
      // Only meaningful once there is a solve to apply it to.
      return state.phase === 'stopped' ? { ...state, penalty: event.penalty } : state;

    case 'pressDown':
      return handlePressDown(state, event.at, config);

    case 'pressUp':
      return handlePressUp(state, event.at, config);

    case 'tick':
      return handleTick(state, event.at, config);

    default:
      return state;
  }
}

function handlePressDown(state: TimerState, at: number, config: TimerConfig): TimerState {
  switch (state.phase) {
    case 'idle':
    case 'stopped': {
      // A press after a finished solve starts the next one. Requiring a separate
      // "next" action would mean reaching for the mouse between every solve, which is
      // not how anyone practises — the cube is in both hands.
      //
      // The finished solve is not lost: it was reported the moment the timer stopped,
      // and the window for adjusting its penalty is exactly "until you start the next
      // one", which is how competition timers behave.
      const fresh = createInitialState();

      // With inspection on, the first press starts the countdown. The solve itself is
      // begun by a second, separate press-and-hold during inspection.
      return config.inspectionEnabled
        ? { ...fresh, phase: 'inspecting', inspectionStartedAt: at }
        : { ...fresh, phase: 'holding', holdStartedAt: at };
    }

    case 'inspecting':
      return { ...state, phase: 'holding', holdStartedAt: at };

    case 'running':
      // Any key stops the timer, which is how competition timers behave — you slap the
      // nearest key rather than aiming for a specific one.
      return { ...state, phase: 'stopped', solveEndedAt: at };

    // A press while already holding is the keyboard repeating, or a second finger.
    // Neither should restart the hold.
    case 'holding':
    case 'ready':
      return state;

    default:
      return state;
  }
}

function handlePressUp(state: TimerState, at: number, config: TimerConfig): TimerState {
  switch (state.phase) {
    case 'ready': {
      // Releasing from ready is what starts the solve. The penalty is fixed here,
      // because it depends on how long inspection took, which is now known.
      const inspectionElapsed =
        state.inspectionStartedAt === undefined ? 0 : at - state.inspectionStartedAt;

      return {
        ...state,
        phase: 'running',
        solveStartedAt: at,
        penalty: config.inspectionEnabled ? inspectionPenaltyFor(inspectionElapsed) : 'none',
      };
    }

    case 'holding':
      // Released too early. Go back to where the hold started from, rather than to idle,
      // so a fumbled press during inspection does not throw the countdown away.
      return state.inspectionStartedAt === undefined
        ? createInitialState()
        : { ...state, phase: 'inspecting', holdStartedAt: undefined };

    // The release of the press that started inspection, or that stopped the timer.
    // Both must be ignored, or the timer would immediately begin again.
    case 'inspecting':
    case 'stopped':
    case 'idle':
    case 'running':
      return state;

    default:
      return state;
  }
}

function handleTick(state: TimerState, at: number, config: TimerConfig): TimerState {
  // The only transition time can cause on its own: a long enough hold becomes ready.
  if (
    state.phase === 'holding' &&
    state.holdStartedAt !== undefined &&
    at - state.holdStartedAt >= config.holdDurationMs
  ) {
    return { ...state, phase: 'ready' };
  }

  return state;
}

/** How long the solve took, in whole milliseconds, once stopped. */
export function solveDurationMs(state: TimerState): number | undefined {
  if (state.solveStartedAt === undefined || state.solveEndedAt === undefined) {
    return undefined;
  }
  return Math.round(state.solveEndedAt - state.solveStartedAt);
}

/** The time to display: elapsed while running, the final time once stopped. */
export function displayDurationMs(state: TimerState, now: number): number {
  if (state.phase === 'running' && state.solveStartedAt !== undefined) {
    return Math.max(0, now - state.solveStartedAt);
  }
  return solveDurationMs(state) ?? 0;
}

/** Inspection time left, which goes negative once the 15 seconds are used up. */
export function inspectionRemainingMs(state: TimerState, now: number): number | undefined {
  if (state.inspectionStartedAt === undefined) return undefined;
  if (state.phase === 'running' || state.phase === 'stopped') return undefined;
  return INSPECTION_DURATION_MS - (now - state.inspectionStartedAt);
}

/**
 * The time a solve counts as, after its penalty.
 *
 * Returns null for a DNF, because a DNF is not a duration — it is the absence of one.
 * Encoding that as `Infinity` or `-1` invites it to be averaged or compared by accident,
 * which is exactly the bug this shape prevents.
 */
export function effectiveDurationMs(durationMs: number, penalty: Penalty): number | null {
  switch (penalty) {
    case 'dnf':
      return null;
    case 'plus2':
      return durationMs + PLUS_TWO_PENALTY_MS;
    case 'none':
      return durationMs;
    default:
      return durationMs;
  }
}
