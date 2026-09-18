import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import { DEFAULT_TIMER_CONFIG } from '@cube-coach/shared';
import { useTimer } from './use-timer.js';

/**
 * A clock we control completely.
 *
 * The state machine never reads a clock, and the hook takes one as an option, so an
 * entire solve can be driven through in a few microseconds. No waiting, and no test
 * that fails one run in fifty because a machine was briefly busy.
 */
let clock = 0;
const now = () => clock;

/** Let the animation frame loop run once, which is what feeds `tick` to the machine. */
function advanceFrame(to: number): void {
  act(() => {
    const delta = Math.max(0, to - clock);
    clock = to;
    vi.advanceTimersByTime(delta);
  });
}

beforeEach(() => {
  clock = 0;
  // setTimeout is faked as well, because arming the timer is now driven by a
  // timeout rather than an animation frame.
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(onSolveComplete?: (result: { durationMs: number; penalty: string }) => void) {
  return renderHook(() =>
    useTimer({
      now,
      config: DEFAULT_TIMER_CONFIG,
      ...(onSolveComplete === undefined ? {} : { onSolveComplete }),
    }),
  );
}

describe('useTimer keyboard handling', () => {
  it('starts holding when space goes down', () => {
    const { result } = setup();

    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });

    expect(result.current.phase).toBe('holding');
  });

  it('runs a complete solve', () => {
    const onSolveComplete = vi.fn();
    const { result } = setup(onSolveComplete);

    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    advanceFrame(600);
    expect(result.current.phase).toBe('ready');

    act(() => {
      clock = 700;
      fireEvent.keyUp(window, { code: 'Space' });
    });
    expect(result.current.phase).toBe('running');

    act(() => {
      clock = 12_700;
      fireEvent.keyDown(window, { code: 'KeyJ' });
    });

    expect(result.current.phase).toBe('stopped');
    expect(onSolveComplete).toHaveBeenCalledTimes(1);
    expect(onSolveComplete).toHaveBeenCalledWith({ durationMs: 12_000, penalty: 'none' });
  });

  /**
   * Space scrolls the page by default. On a timer that is intolerable: every start and
   * stop would jump the view.
   */
  it('prevents the default action of the space key', () => {
    setup();

    const event = new KeyboardEvent('keydown', { code: 'Space', cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });

  /**
   * Holding a key makes the browser fire keydown repeatedly. Acting on the repeats would
   * restart the hold each time, so the timer would never become ready.
   */
  it('ignores auto-repeat while a key is held', () => {
    const { result } = setup();

    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    advanceFrame(300);

    act(() => {
      fireEvent.keyDown(window, { code: 'Space', repeat: true });
    });
    advanceFrame(560);

    // If the repeat had been acted on, the hold would have restarted at 300ms and this
    // would still be `holding` at 560ms.
    expect(result.current.phase).toBe('ready');
  });

  it('does not start on keys other than space', () => {
    const { result } = setup();

    act(() => {
      fireEvent.keyDown(window, { code: 'KeyK' });
    });

    expect(result.current.phase).toBe('idle');
  });

  it('stops on any key, not only space', () => {
    const { result } = setup();

    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    advanceFrame(600);
    act(() => {
      clock = 700;
      fireEvent.keyUp(window, { code: 'Space' });
    });
    act(() => {
      clock = 3_700;
      fireEvent.keyDown(window, { code: 'Escape' });
    });

    expect(result.current.phase).toBe('stopped');
  });

  /** Typing a password should not start a solve. */
  it('ignores keys pressed inside a form field', () => {
    const { result } = setup();
    const input = document.createElement('input');
    document.body.append(input);

    act(() => {
      fireEvent.keyDown(input, { code: 'Space' });
    });

    expect(result.current.phase).toBe('idle');
    input.remove();
  });

  /**
   * Alt-tabbing mid-hold means the key-up never arrives. Without handling blur, the
   * timer stays stuck in `holding` forever.
   */
  it('abandons a hold when the window loses focus', () => {
    const { result } = setup();

    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    act(() => {
      fireEvent.blur(window);
    });

    expect(result.current.phase).toBe('idle');
  });

  it('does not abandon a solve already running when focus is lost', () => {
    const { result } = setup();

    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    advanceFrame(600);
    act(() => {
      clock = 700;
      fireEvent.keyUp(window, { code: 'Space' });
    });
    act(() => {
      fireEvent.blur(window);
    });

    expect(result.current.phase).toBe('running');
  });

  it('stops listening once unmounted', () => {
    const { result, unmount } = setup();
    unmount();

    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });

    expect(result.current.phase).toBe('idle');
  });
});

describe('useTimer between solves', () => {
  function completeSolve(result: ReturnType<typeof setup>['result']): void {
    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    advanceFrame(600);
    act(() => {
      clock = 700;
      fireEvent.keyUp(window, { code: 'Space' });
    });
    act(() => {
      clock = 5_700;
      fireEvent.keyDown(window, { code: 'KeyJ' });
    });
    act(() => {
      clock = 5_800;
      fireEvent.keyUp(window, { code: 'KeyJ' });
    });
    expect(result.current.phase).toBe('stopped');
  }

  /**
   * The bug this test exists for: the timer used to sit in `stopped` until a button was
   * clicked, so starting the next solve meant reaching for the mouse — while holding a
   * cube in both hands.
   */
  it('starts the next solve on the next spacebar press', () => {
    const { result } = setup();
    completeSolve(result);

    act(() => {
      clock = 8_000;
      fireEvent.keyDown(window, { code: 'Space' });
    });

    expect(result.current.phase).toBe('holding');
  });

  it('reports each solve exactly once', () => {
    const onSolveComplete = vi.fn();
    const { result } = setup(onSolveComplete);

    completeSolve(result);
    expect(onSolveComplete).toHaveBeenCalledTimes(1);

    act(() => {
      clock = 8_000;
      fireEvent.keyDown(window, { code: 'Space' });
    });
    advanceFrame(8_600);
    act(() => {
      clock = 8_700;
      fireEvent.keyUp(window, { code: 'Space' });
    });
    act(() => {
      clock = 11_700;
      fireEvent.keyDown(window, { code: 'KeyJ' });
    });

    expect(onSolveComplete).toHaveBeenCalledTimes(2);
    expect(onSolveComplete).toHaveBeenLastCalledWith({ durationMs: 3_000, penalty: 'none' });
  });

  /**
   * After clicking a penalty button it still has focus. Without this guard the next
   * spacebar press would both re-toggle the penalty and start a solve.
   */
  it('does not start a solve when a button has focus', () => {
    const { result } = setup();
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();

    act(() => {
      fireEvent.keyDown(button, { code: 'Space' });
    });

    expect(result.current.phase).toBe('idle');
    button.remove();
  });

  it('still stops a running solve when a button has focus', () => {
    const { result } = setup();
    const button = document.createElement('button');
    document.body.append(button);

    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    advanceFrame(600);
    act(() => {
      clock = 700;
      fireEvent.keyUp(window, { code: 'Space' });
    });

    act(() => {
      clock = 4_700;
      fireEvent.keyDown(button, { code: 'Enter' });
    });

    expect(result.current.phase).toBe('stopped');
    button.remove();
  });
});
