import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
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

/**
 * The bug these exist for: the arming timeout is a single shot, and a `tick` that
 * arrives even a fraction of a millisecond early is silently discarded. Nothing
 * reschedules, so the timer sits on `holding` — red, never green — until released.
 */
describe('useTimer arming', () => {
  it('still arms when the hold timeout fires a fraction early', () => {
    const { result } = setup();

    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });

    // `setTimeout` truncates a fractional delay and `performance.now()` is coarsened,
    // so the callback can land just before the clock agrees the hold is complete.
    act(() => {
      clock = 549.9;
      vi.advanceTimersByTime(550);
    });

    // Whether it arms on this tick or on a rescheduled one, it must not be stuck: by
    // the time the hold is unambiguously complete, the timer is armed.
    advanceFrame(600);
    expect(result.current.phase).toBe('ready');
  });

  it('does not stay stuck in holding after an early tick', () => {
    const { result } = setup();

    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    act(() => {
      clock = 549.9;
      vi.advanceTimersByTime(550);
    });

    // Long past any plausible hold, with frames still arriving.
    advanceFrame(5_000);
    expect(result.current.phase).toBe('ready');
  });
});

/**
 * The surface is where a phone starts a solve, and a pointer gesture has more ways to
 * end than a key press does. Each of these left the timer stuck on `holding` — red,
 * with no way out but releasing and starting over.
 */
describe('useTimer pointer handling', () => {
  function renderSurface() {
    function Surface(): ReactElement {
      const timer = useTimer({ now, config: DEFAULT_TIMER_CONFIG });
      return (
        <section data-testid="surface" {...timer.surfaceProps}>
          {timer.phase}
        </section>
      );
    }

    render(<Surface />);
    return screen.getByTestId('surface');
  }

  it('starts a hold on a press', () => {
    const surface = renderSurface();

    act(() => {
      fireEvent.pointerDown(surface, { pointerId: 1 });
    });

    expect(surface).toHaveTextContent('holding');
  });

  it('runs a solve from press to release to press', () => {
    const surface = renderSurface();

    act(() => {
      fireEvent.pointerDown(surface, { pointerId: 1 });
    });
    advanceFrame(600);
    expect(surface).toHaveTextContent('ready');

    act(() => {
      clock = 700;
      fireEvent.pointerUp(surface, { pointerId: 1 });
    });
    expect(surface).toHaveTextContent('running');

    act(() => {
      clock = 8_700;
      fireEvent.pointerDown(surface, { pointerId: 2 });
    });
    expect(surface).toHaveTextContent('stopped');
  });

  /**
   * A browser that decides a touch was really a scroll, a pinch or a long-press menu
   * takes the gesture away and sends `pointercancel` instead of `pointerup`. The
   * release never arrives, so without this the timer holds at red forever.
   */
  it('abandons the hold when the browser cancels the gesture', () => {
    const surface = renderSurface();

    act(() => {
      fireEvent.pointerDown(surface, { pointerId: 1 });
    });
    advanceFrame(200);
    act(() => {
      fireEvent.pointerCancel(surface, { pointerId: 1 });
    });

    expect(surface).toHaveTextContent('idle');
  });

  /** A cancelled gesture must not start a solve that was never released into. */
  it('does not start a solve when an armed gesture is cancelled', () => {
    const surface = renderSurface();

    act(() => {
      fireEvent.pointerDown(surface, { pointerId: 1 });
    });
    advanceFrame(600);
    expect(surface).toHaveTextContent('ready');

    act(() => {
      fireEvent.pointerCancel(surface, { pointerId: 1 });
    });

    expect(surface).toHaveTextContent('idle');
  });

  /** A cancelled touch mid-solve must not stop the clock. */
  it('keeps a running solve when a stray gesture is cancelled', () => {
    const surface = renderSurface();

    act(() => {
      fireEvent.pointerDown(surface, { pointerId: 1 });
    });
    advanceFrame(600);
    act(() => {
      clock = 700;
      fireEvent.pointerUp(surface, { pointerId: 1 });
    });
    expect(surface).toHaveTextContent('running');

    act(() => {
      clock = 2_000;
      fireEvent.pointerDown(surface, { pointerId: 2 });
      fireEvent.pointerCancel(surface, { pointerId: 2 });
    });

    // The press stopped it, as any press should. The cancel must not have undone that.
    expect(surface).toHaveTextContent('stopped');
  });

  /**
   * Two hands on a cube means two thumbs on the screen. The second one landing, or
   * lifting, is not what starts or ends the hold — only the finger that began it.
   */
  it('ignores a second finger landing and lifting mid-hold', () => {
    const surface = renderSurface();

    act(() => {
      fireEvent.pointerDown(surface, { pointerId: 1 });
    });
    advanceFrame(200);

    act(() => {
      fireEvent.pointerDown(surface, { pointerId: 2 });
      fireEvent.pointerUp(surface, { pointerId: 2 });
    });

    expect(surface).toHaveTextContent('holding');

    advanceFrame(700);
    expect(surface).toHaveTextContent('ready');
  });

  /**
   * A finger drifts while it holds. Without capturing the pointer the release is
   * delivered to whatever is under it by then, the surface never hears it, and the
   * timer stays held.
   */
  it('captures the pointer so the release cannot be delivered elsewhere', () => {
    const surface = renderSurface();
    const capture = vi.spyOn(surface, 'setPointerCapture');

    act(() => {
      fireEvent.pointerDown(surface, { pointerId: 7 });
    });

    expect(capture).toHaveBeenCalledWith(7);
  });
});

/**
 * Capturing the pointer is an improvement on the release, not a condition of the press.
 * `setPointerCapture` throws whenever the pointer is no longer active by the time it is
 * asked — and a throw inside the handler used to swallow the press entirely, so the
 * timer did not start at all.
 */
describe('useTimer pointer capture failure', () => {
  it('still starts the hold when the pointer cannot be captured', () => {
    function Surface(): ReactElement {
      const timer = useTimer({ now, config: DEFAULT_TIMER_CONFIG });
      return (
        <section data-testid="surface" {...timer.surfaceProps}>
          {timer.phase}
        </section>
      );
    }

    render(<Surface />);
    const surface = screen.getByTestId('surface');
    vi.spyOn(surface, 'setPointerCapture').mockImplementation(() => {
      throw new DOMException('No active pointer with the given id', 'NotFoundError');
    });

    act(() => {
      fireEvent.pointerDown(surface, { pointerId: 1 });
    });
    expect(surface).toHaveTextContent('holding');

    advanceFrame(600);
    expect(surface).toHaveTextContent('ready');
  });
});
