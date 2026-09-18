import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  displayDurationMs,
  effectiveDurationMs,
  inspectionPenaltyFor,
  inspectionRemainingMs,
  solveDurationMs,
  timerReducer,
} from './timer-machine.js';
import { DEFAULT_TIMER_CONFIG, type TimerEvent, type TimerState } from './types.js';

const WITHOUT_INSPECTION = { ...DEFAULT_TIMER_CONFIG, inspectionEnabled: false };
const WITH_INSPECTION = { ...DEFAULT_TIMER_CONFIG, inspectionEnabled: true };

/**
 * Drive the machine through a list of events.
 *
 * Every event carries its own timestamp, so a full solve runs in microseconds. No fake
 * timers, no waiting, no flakiness — the reducer never reads a clock, so there is no
 * clock to fake.
 */
function run(events: TimerEvent[], config = WITHOUT_INSPECTION, from = createInitialState()) {
  return events.reduce<TimerState>((state, event) => timerReducer(state, event, config), from);
}

describe('starting a solve', () => {
  it('begins idle', () => {
    expect(createInitialState().phase).toBe('idle');
  });

  it('enters holding when a key goes down', () => {
    expect(run([{ type: 'pressDown', at: 0 }]).phase).toBe('holding');
  });

  it('is not ready until the key has been held long enough', () => {
    const state = run([
      { type: 'pressDown', at: 0 },
      { type: 'tick', at: 300 },
    ]);

    expect(state.phase).toBe('holding');
  });

  it('becomes ready once the hold threshold passes', () => {
    const state = run([
      { type: 'pressDown', at: 0 },
      { type: 'tick', at: 550 },
    ]);

    expect(state.phase).toBe('ready');
  });

  it('returns to idle if released before becoming ready', () => {
    const state = run([
      { type: 'pressDown', at: 0 },
      { type: 'tick', at: 200 },
      { type: 'pressUp', at: 250 },
    ]);

    expect(state.phase).toBe('idle');
  });

  it('starts running when released from ready', () => {
    const state = run([
      { type: 'pressDown', at: 0 },
      { type: 'tick', at: 600 },
      { type: 'pressUp', at: 700 },
    ]);

    expect(state.phase).toBe('running');
    expect(state.solveStartedAt).toBe(700);
  });

  /**
   * A held key repeats: the browser fires keydown over and over. If each one restarted
   * the hold, the timer would never reach ready and the app would appear broken.
   */
  it('ignores repeated key-down events while holding', () => {
    const state = run([
      { type: 'pressDown', at: 0 },
      { type: 'pressDown', at: 30 },
      { type: 'pressDown', at: 60 },
      { type: 'tick', at: 560 },
    ]);

    expect(state.phase).toBe('ready');
    expect(state.holdStartedAt).toBe(0);
  });
});

describe('stopping a solve', () => {
  const started: TimerEvent[] = [
    { type: 'pressDown', at: 0 },
    { type: 'tick', at: 600 },
    { type: 'pressUp', at: 700 },
  ];

  it('stops on any key press', () => {
    const state = run([...started, { type: 'pressDown', at: 12_000 }]);

    expect(state.phase).toBe('stopped');
    expect(solveDurationMs(state)).toBe(11_300);
  });

  /**
   * The release of the key that stopped the timer must not start another solve. This is
   * the bug that makes a timer restart itself the instant you stop it.
   */
  it('ignores the release of the key that stopped it', () => {
    const state = run([
      ...started,
      { type: 'pressDown', at: 12_000 },
      { type: 'pressUp', at: 12_100 },
    ]);

    expect(state.phase).toBe('stopped');
    expect(solveDurationMs(state)).toBe(11_300);
  });

  /**
   * A press after a finished solve starts the next one, rather than being ignored.
   * Requiring a separate action between solves would mean reaching for the mouse while
   * holding a cube.
   */
  it('starts the next solve on the next press', () => {
    const state = run([
      ...started,
      { type: 'pressDown', at: 12_000 },
      { type: 'pressUp', at: 12_100 },
      { type: 'pressDown', at: 13_000 },
    ]);

    expect(state.phase).toBe('holding');
    expect(state.holdStartedAt).toBe(13_000);
    expect(state.solveEndedAt).toBeUndefined();
  });

  it('reports elapsed time while running and the final time once stopped', () => {
    const running = run(started);
    expect(displayDurationMs(running, 5_700)).toBe(5_000);

    const stopped = run([...started, { type: 'pressDown', at: 12_000 }]);
    expect(displayDurationMs(stopped, 99_999)).toBe(11_300);
  });

  it('resets back to idle', () => {
    const state = run([...started, { type: 'pressDown', at: 12_000 }, { type: 'reset' }]);

    expect(state.phase).toBe('idle');
    expect(solveDurationMs(state)).toBeUndefined();
  });
});

describe('inspection', () => {
  it('starts the countdown on the first press', () => {
    const state = run([{ type: 'pressDown', at: 0 }], WITH_INSPECTION);

    expect(state.phase).toBe('inspecting');
    expect(state.inspectionStartedAt).toBe(0);
  });

  it('ignores the release of the press that started it', () => {
    const state = run(
      [
        { type: 'pressDown', at: 0 },
        { type: 'pressUp', at: 80 },
      ],
      WITH_INSPECTION,
    );

    expect(state.phase).toBe('inspecting');
  });

  it('holds and becomes ready during inspection', () => {
    const state = run(
      [
        { type: 'pressDown', at: 0 },
        { type: 'pressUp', at: 80 },
        { type: 'pressDown', at: 5_000 },
        { type: 'tick', at: 5_600 },
      ],
      WITH_INSPECTION,
    );

    expect(state.phase).toBe('ready');
  });

  // A fumbled press mid-inspection must not throw the countdown away and send the cuber
  // back to the start with a fresh 15 seconds.
  it('returns to inspecting, not idle, when a hold is released early', () => {
    const state = run(
      [
        { type: 'pressDown', at: 0 },
        { type: 'pressUp', at: 80 },
        { type: 'pressDown', at: 5_000 },
        { type: 'pressUp', at: 5_100 },
      ],
      WITH_INSPECTION,
    );

    expect(state.phase).toBe('inspecting');
    expect(state.inspectionStartedAt).toBe(0);
  });

  it('counts down and goes negative once the 15 seconds are used', () => {
    const state = run([{ type: 'pressDown', at: 0 }], WITH_INSPECTION);

    expect(inspectionRemainingMs(state, 0)).toBe(15_000);
    expect(inspectionRemainingMs(state, 10_000)).toBe(5_000);
    expect(inspectionRemainingMs(state, 16_000)).toBe(-1_000);
  });

  it('stops reporting a countdown once the solve is running', () => {
    const state = run(
      [
        { type: 'pressDown', at: 0 },
        { type: 'pressUp', at: 80 },
        { type: 'pressDown', at: 5_000 },
        { type: 'tick', at: 5_600 },
        { type: 'pressUp', at: 5_700 },
      ],
      WITH_INSPECTION,
    );

    expect(inspectionRemainingMs(state, 6_000)).toBeUndefined();
  });
});

describe('inspection penalties', () => {
  // The WCA thresholds exactly: 15 seconds, then a two-second grace band, then DNF.
  it.each([
    [0, 'none'],
    [14_999, 'none'],
    [15_000, 'none'],
    [15_001, 'plus2'],
    [17_000, 'plus2'],
    [17_001, 'dnf'],
    [30_000, 'dnf'],
  ])('an inspection of %ims earns %s', (elapsed, expected) => {
    expect(inspectionPenaltyFor(elapsed)).toBe(expected);
  });

  function solveAfterInspectionOf(milliseconds: number) {
    return run(
      [
        { type: 'pressDown', at: 0 },
        { type: 'pressUp', at: 80 },
        { type: 'pressDown', at: milliseconds - 600 },
        { type: 'tick', at: milliseconds },
        { type: 'pressUp', at: milliseconds },
      ],
      WITH_INSPECTION,
    );
  }

  it('applies no penalty when the solve starts in time', () => {
    expect(solveAfterInspectionOf(10_000).penalty).toBe('none');
  });

  it('applies +2 when inspection overruns', () => {
    expect(solveAfterInspectionOf(16_000).penalty).toBe('plus2');
  });

  it('applies a DNF past the grace band', () => {
    expect(solveAfterInspectionOf(18_000).penalty).toBe('dnf');
  });

  it('never applies an inspection penalty when inspection is disabled', () => {
    const state = run([
      { type: 'pressDown', at: 0 },
      { type: 'tick', at: 600 },
      { type: 'pressUp', at: 60_000 },
    ]);

    expect(state.penalty).toBe('none');
  });
});

describe('penalties applied afterwards', () => {
  const stopped = run([
    { type: 'pressDown', at: 0 },
    { type: 'tick', at: 600 },
    { type: 'pressUp', at: 700 },
    { type: 'pressDown', at: 13_000 },
  ]);

  it('can be set once the solve has stopped', () => {
    const state = timerReducer(
      stopped,
      { type: 'setPenalty', penalty: 'plus2' },
      WITHOUT_INSPECTION,
    );

    expect(state.penalty).toBe('plus2');
    // The raw measurement is untouched. Only the penalty changes, so toggling it
    // repeatedly cannot drift the recorded time.
    expect(solveDurationMs(state)).toBe(12_300);
  });

  it('is ignored while a solve is still running', () => {
    const running = run([
      { type: 'pressDown', at: 0 },
      { type: 'tick', at: 600 },
      { type: 'pressUp', at: 700 },
    ]);

    const state = timerReducer(running, { type: 'setPenalty', penalty: 'dnf' }, WITHOUT_INSPECTION);
    expect(state.penalty).toBe('none');
  });
});

describe('cancelling', () => {
  // Losing focus mid-hold — alt-tab, a notification stealing focus — must not leave the
  // timer stuck in `holding` forever waiting for a key-up that will never arrive.
  it('abandons a hold in progress', () => {
    const state = run([{ type: 'pressDown', at: 0 }, { type: 'cancel' }]);

    expect(state.phase).toBe('idle');
  });

  it('does not throw away a solve that is already running', () => {
    const state = run([
      { type: 'pressDown', at: 0 },
      { type: 'tick', at: 600 },
      { type: 'pressUp', at: 700 },
      { type: 'cancel' },
    ]);

    expect(state.phase).toBe('running');
  });

  it('does not discard a finished solve', () => {
    const state = run([
      { type: 'pressDown', at: 0 },
      { type: 'tick', at: 600 },
      { type: 'pressUp', at: 700 },
      { type: 'pressDown', at: 9_000 },
      { type: 'cancel' },
    ]);

    expect(state.phase).toBe('stopped');
    expect(solveDurationMs(state)).toBe(8_300);
  });
});

describe('effectiveDurationMs', () => {
  it('leaves a clean solve alone', () => {
    expect(effectiveDurationMs(12_340, 'none')).toBe(12_340);
  });

  it('adds two seconds for a +2', () => {
    expect(effectiveDurationMs(12_340, 'plus2')).toBe(14_340);
  });

  // null, not Infinity or -1: a DNF is the absence of a time, and encoding it as a
  // number invites it to be averaged or compared by accident.
  it('has no duration for a DNF', () => {
    expect(effectiveDurationMs(12_340, 'dnf')).toBeNull();
  });
});
