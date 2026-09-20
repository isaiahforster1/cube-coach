import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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
  // `ready` is included because the inspection countdown is still on screen while
  // armed. Leaving it out froze that number at whatever it read when the hold
  // began, which looks like a bug even though the timing was correct.
  return phase === 'holding' || phase === 'inspecting' || phase === 'running' || phase === 'ready';
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

  /**
   * A stable reference to the clock.
   *
   * The `now` option defaults to an arrow function, so a caller that does not pass one
   * hands in a brand new function on every render. Used directly in effect dependencies
   * that makes every effect tear down and re-run each render — which, while the animation
   * loop is running, means cancelling and rescheduling the arming timeout sixty times a
   * second. It still fired at roughly the right moment, but nothing about that is
   * something to rely on.
   */
  const nowRef = useRef(now);
  nowRef.current = now;
  const readNow = useCallback(() => nowRef.current(), []);

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
   *
   * It re-arms itself rather than firing once, which is what makes it reliable.
   *
   * A single shot has to land on the far side of a boundary that two different clocks
   * disagree about. `setTimeout` truncates a fractional delay to whole milliseconds,
   * and `performance.now()` is deliberately coarsened — so the callback can arrive a
   * hair before the clock agrees the hold is complete. The reducer, quite correctly,
   * refuses to arm a hold that is 549.9ms long. Nothing then changed, so the effect's
   * dependencies did not change either, so nothing rescheduled: the timer sat on
   * `holding` — red, never green — until the key came back up, and the solve had to be
   * started again. Intermittent, and maddening at speed.
   *
   * Checking the clock and scheduling again for whatever is left removes the boundary
   * problem entirely. `Math.ceil` keeps each wait from being short for the same
   * truncation reason, so this settles in one extra hop at most.
   */
  useEffect(() => {
    if (state.phase !== 'holding') return;

    const holdStartedAt = state.holdStartedAt;
    if (holdStartedAt === undefined) return;

    const { holdDurationMs } = config;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    // An arrow const rather than a function declaration, which would be hoisted above
    // the check above and so lose the narrowing on `holdStartedAt`.
    const arm = (): void => {
      const at = readNow();
      const remaining = holdDurationMs - (at - holdStartedAt);

      if (remaining <= 0) {
        dispatch({ type: 'tick', at });
        return;
      }

      timeout = setTimeout(arm, Math.ceil(remaining));
    };

    arm();

    return () => {
      clearTimeout(timeout);
    };
  }, [state.phase, state.holdStartedAt, config, dispatch, readNow]);

  /** Repaint while something is moving. Display only — no state depends on this. */
  useEffect(() => {
    if (!isAnimating(state.phase)) return;

    /**
     * Refresh the clock immediately, before waiting for a frame.
     *
     * `frameNow` is only updated by the animation loop, so on entering a phase it still
     * holds whatever it read last — possibly from page load, minutes ago. The first
     * render of an inspection countdown would then compute its remaining time against a
     * stale timestamp and show a number that is simply wrong, until the next frame
     * corrected it. In a throttled tab, where frames are rare, it stays wrong.
     */
    setFrameNow(readNow());

    let frame = requestAnimationFrame(function loop() {
      setFrameNow(readNow());
      frame = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [state.phase, readNow]);

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
        dispatch({ type: 'pressDown', at: readNow() });
      }
    }

    function handleKeyUp(event: KeyboardEvent): void {
      if (isFormControl(event.target)) return;
      if (event.code === 'Space') event.preventDefault();
      dispatch({ type: 'pressUp', at: readNow() });
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
    // `readNow` rather than `now`: the latter is a fresh arrow function on every render
    // for any caller that does not pass one, which would detach and re-attach these
    // listeners sixty times a second while the animation loop runs.
  }, [dispatch, readNow]);

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

  /**
   * Stable callbacks, so a caller can depend on them in an effect without it re-running
   * on every render.
   */
  const setPenalty = useCallback(
    (penalty: Penalty) => {
      dispatch({ type: 'setPenalty', penalty });
    },
    [dispatch],
  );

  const reset = useCallback(() => {
    dispatch({ type: 'reset' });
  }, [dispatch]);

  /**
   * Which finger owns the hold.
   *
   * A keyboard has one spacebar; a phone held in two hands has two thumbs over the
   * screen, and every one of them produces its own pointer with its own `pointerup`.
   * Without knowing which pointer began the hold, a second thumb resting on the screen
   * and lifting again would end a hold the first thumb is still making.
   */
  const holdingPointerRef = useRef<number | null>(null);

  const surfaceProps = useMemo(
    () => ({
      onPointerDown(event: ReactPointerEvent<Element>): void {
        // A second finger landing mid-hold is not the start of anything.
        if (holdingPointerRef.current !== null) return;
        holdingPointerRef.current = event.pointerId;

        // The press comes first. Everything below is an improvement on it, and none of
        // it is worth risking the one thing this handler exists to do.
        dispatch({ type: 'pressDown', at: readNow() });

        /**
         * Capture the pointer, so every later event for it is delivered here.
         *
         * A finger drifts over half a second of holding, and a mouse can be dragged off
         * deliberately. Without capture the `pointerup` goes to whatever element the
         * pointer has wandered onto, this surface never hears it, and the timer stays
         * held with no way out.
         *
         * It throws if the pointer is no longer active by the time we ask — a touch
         * already lifted, a pointer the browser has taken back. Letting that escape
         * would abandon the press itself, which is a far worse failure than a release
         * that has to find its own way home.
         */
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Not capturable. The hold still stands; `blur` and `pointercancel` remain as
          // the ways out if the release goes astray.
        }
      },

      onPointerUp(event: ReactPointerEvent<Element>): void {
        if (holdingPointerRef.current !== event.pointerId) return;
        holdingPointerRef.current = null;

        dispatch({ type: 'pressUp', at: readNow() });
      },

      /**
       * The browser taking the gesture away — a scroll it decided was really a scroll,
       * a pinch, a long-press menu, a system edge swipe. `pointerup` never comes, so
       * this is the only signal that the press is over.
       *
       * It abandons rather than releasing, because a gesture that was taken away is not
       * a deliberate release: releasing from `ready` would start a solve nobody asked
       * for. `cancel` leaves a running solve alone, which is what protects the clock
       * from a stray touch elsewhere on the screen mid-solve.
       */
      onPointerCancel(event: ReactPointerEvent<Element>): void {
        if (holdingPointerRef.current !== event.pointerId) return;
        holdingPointerRef.current = null;

        dispatch({ type: 'cancel' });
      },
    }),
    [dispatch, readNow],
  );

  return {
    state,
    phase: state.phase,
    penalty: state.penalty,
    displayMs: displayDurationMs(state, frameNow),
    inspectionRemainingMs: inspectionRemainingMs(state, frameNow),
    setPenalty,
    reset,
    /** Touch and mouse support, attached to the timer surface rather than the window. */
    surfaceProps,
  };
}
