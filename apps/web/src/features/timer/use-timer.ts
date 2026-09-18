import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createInitialState,
  DEFAULT_TIMER_CONFIG,
  displayDurationMs,
  inspectionRemainingMs,
  solveDurationMs,
  timerReducer,
  type Penalty,
  type TimerConfig,
  type TimerEvent,
  type TimerPhase,
} from '@cube-coach/shared';

export interface SolveResult {
  readonly durationMs: number;
  readonly penalty: Penalty;
}

export interface UseTimerOptions {
  readonly config?: TimerConfig;
  readonly onSolveComplete?: (result: SolveResult) => void;
  /**
   * The clock. Injected so tests can drive time by hand, and defaulting to
   * `performance.now` rather than `Date.now`.
   *
   * That difference matters: `Date.now` follows the system clock, which can jump
   * backwards when NTP corrects it or when the user changes their timezone. A solve
   * timed across such a jump would record a negative or wildly wrong duration.
   * `performance.now` is monotonic — it only ever moves forward.
   */
  readonly now?: () => number;
}

/** Phases where the display changes every frame and needs animating. */
function isAnimating(phase: TimerPhase): boolean {
  return phase === 'holding' || phase === 'inspecting' || phase === 'running';
}

/**
 * Keys aimed at a form control or a button belong to that control, not to the timer.
 *
 * Without this, pressing space while the "+2" button still has focus after a click
 * would both toggle the penalty and start the next solve.
 */
function isFormControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'BUTTON' ||
    target.isContentEditable
  );
}

export function useTimer({
  config = DEFAULT_TIMER_CONFIG,
  onSolveComplete,
  now = () => performance.now(),
}: UseTimerOptions = {}) {
  const [state, setState] = useState(createInitialState);
  const [frameNow, setFrameNow] = useState(() => now());

  // Handlers are attached once, so they would otherwise close over the phase as it was
  // on first render. A ref gives them the current value without re-binding listeners on
  // every transition.
  const phaseRef = useRef(state.phase);
  phaseRef.current = state.phase;

  const dispatch = useCallback(
    (event: TimerEvent) => {
      // Functional update rather than reading `state`: the same stale-closure problem,
      // solved by React handing us the latest state instead.
      setState((previous) => timerReducer(previous, event, config));
    },
    [config],
  );

  /**
   * Promote a long-enough hold to `ready`.
   *
   * Deliberately a timeout rather than something driven by the animation loop.
   * requestAnimationFrame is for painting, and browsers throttle it hard — background
   * tabs, battery saver, an unfocused window. Arming the timer is a state change that
   * must happen after a fixed duration whether or not anything is being repainted, so
   * it gets its own timer.
   */
  useEffect(() => {
    if (state.phase !== 'holding' || state.holdStartedAt === undefined) return;

    const elapsed = now() - state.holdStartedAt;
    const remaining = Math.max(0, config.holdDurationMs - elapsed);

    const timeout = setTimeout(() => {
      dispatch({ type: 'tick', at: now() });
    }, remaining);

    return () => {
      clearTimeout(timeout);
    };
  }, [state.phase, state.holdStartedAt, config.holdDurationMs, dispatch, now]);

  /** Repaint while something is moving. Display only — no state depends on this. */
  useEffect(() => {
    if (!isAnimating(state.phase)) return;

    let frame = requestAnimationFrame(function loop() {
      setFrameNow(now());
      frame = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [state.phase, now]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const running = phaseRef.current === 'running';

      // A focused button or field owns its own keys — except while a solve is
      // running, when any key must stop the timer wherever focus happens to be.
      if (!running && isFormControl(event.target)) return;

      // A held key repeats. Only the first press is a real press; the rest would
      // restart the hold and the timer would never become ready.
      if (event.repeat) return;

      // Space scrolls the page by default, which is intolerable on a timer.
      if (event.code === 'Space') event.preventDefault();

      // Any key stops a running solve — you slap the nearest one. Only space starts one,
      // so ordinary typing and shortcuts do not launch a solve by accident.
      if (running || event.code === 'Space') {
        dispatch({ type: 'pressDown', at: now() });
      }
    }

    function handleKeyUp(event: KeyboardEvent): void {
      if (isFormControl(event.target)) return;
      if (event.code === 'Space') event.preventDefault();
      dispatch({ type: 'pressUp', at: now() });
    }

    /**
     * Losing focus mid-hold — alt-tab, a notification — means the key-up will never
     * arrive. Without this the timer stays stuck in `holding` forever.
     */
    function handleBlur(): void {
      dispatch({ type: 'cancel' });
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [dispatch, now]);

  // Report the finished solve exactly once, when the machine reaches `stopped`.
  const reportedRef = useRef(false);
  useEffect(() => {
    if (state.phase !== 'stopped') {
      reportedRef.current = false;
      return;
    }

    if (reportedRef.current) return;
    const durationMs = solveDurationMs(state);
    if (durationMs === undefined) return;

    reportedRef.current = true;
    onSolveComplete?.({ durationMs, penalty: state.penalty });
  }, [state, onSolveComplete]);

  return {
    state,
    phase: state.phase,
    penalty: state.penalty,
    displayMs: displayDurationMs(state, frameNow),
    inspectionRemainingMs: inspectionRemainingMs(state, frameNow),
    setPenalty: (penalty: Penalty) => {
      dispatch({ type: 'setPenalty', penalty });
    },
    reset: () => {
      dispatch({ type: 'reset' });
    },
    /** Touch and mouse support, attached to the timer surface rather than the window. */
    surfaceProps: {
      onPointerDown: () => {
        dispatch({ type: 'pressDown', at: now() });
      },
      onPointerUp: () => {
        dispatch({ type: 'pressUp', at: now() });
      },
    },
  };
}
