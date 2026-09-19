import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTurnAnimation } from './use-turn-animation.js';

let clock = 0;
const now = () => clock;

const MS_PER_MOVE = 400;

/**
 * Advance in small steps rather than one jump, so React gets to run effects in between —
 * a turn ends inside an animation frame and anything queued in response only happens
 * once `act` returns.
 */
function advanceTo(to: number): void {
  const step = 40;

  while (clock < to) {
    const next = Math.min(to, clock + step);
    act(() => {
      const delta = next - clock;
      clock = next;
      vi.advanceTimersByTime(delta);
    });
  }
}

beforeEach(() => {
  clock = 0;
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(onSettled = vi.fn()) {
  const rendered = renderHook(() =>
    useTurnAnimation<string>({ msPerMove: MS_PER_MOVE, now, onSettled }),
  );
  return { ...rendered, onSettled };
}

describe('useTurnAnimation', () => {
  it('is still until told to turn', () => {
    const { result } = setup();

    expect(result.current.turn).toBeNull();
    expect(result.current.isTurning).toBe(false);
    expect(result.current.pending).toBeNull();
  });

  it('draws the starting angle straight away, not a frame later', () => {
    const { result } = setup();

    act(() => {
      result.current.start({ move: 'R', from: 0, to: 90, payload: 'one' });
    });

    expect(result.current.turn).toEqual({ move: 'R', angle: 0 });
  });

  it('sweeps between the two angles', () => {
    const { result } = setup();

    act(() => {
      result.current.start({ move: 'R', from: 0, to: 90, payload: 'one' });
    });
    advanceTo(MS_PER_MOVE / 2);

    const angle = result.current.turn?.angle ?? 0;
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(90);
  });

  it('winds backwards when the angles are the other way round', () => {
    const { result } = setup();

    act(() => {
      result.current.start({ move: 'R', from: 90, to: 0, payload: 'one' });
    });
    advanceTo(MS_PER_MOVE / 2);

    const angle = result.current.turn?.angle ?? 0;
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(90);
  });

  it('hands the payload back when the turn lands', () => {
    const { result, onSettled } = setup();

    act(() => {
      result.current.start({ move: 'R', from: 0, to: 90, payload: 'landed' });
    });
    advanceTo(MS_PER_MOVE + 40);

    expect(onSettled).toHaveBeenCalledExactlyOnceWith('landed');
    expect(result.current.turn).toBeNull();
    expect(result.current.pending).toBeNull();
  });

  it('exposes what is in the air while it is turning', () => {
    const { result } = setup();

    act(() => {
      result.current.start({ move: 'U', from: 0, to: -90, payload: 'in-flight' });
    });

    expect(result.current.pending).toBe('in-flight');
    expect(result.current.isTurning).toBe(true);
  });

  it('gives a half turn longer, because it has twice as far to go', () => {
    const { result, onSettled } = setup();

    act(() => {
      result.current.start({ move: 'R2', from: 0, to: 180, payload: 'half' });
    });

    advanceTo(MS_PER_MOVE + 40);
    expect(onSettled).not.toHaveBeenCalled();

    advanceTo(MS_PER_MOVE * 1.4 + 40);
    expect(onSettled).toHaveBeenCalledWith('half');
  });

  /**
   * Replacing rather than queueing or refusing. Refusing is what the first version did,
   * and pressing a button three times quickly moved the cube once, which felt broken.
   * The caller folds `pending` into its own state before starting the next turn, so the
   * interrupted move is not lost — it is just not this hook's job to commit it.
   */
  it('replaces a turn in flight without committing it', () => {
    const { result, onSettled } = setup();

    act(() => {
      result.current.start({ move: 'R', from: 0, to: 90, payload: 'first' });
    });
    advanceTo(MS_PER_MOVE / 2);

    act(() => {
      result.current.start({ move: 'U', from: 0, to: 90, payload: 'second' });
    });

    expect(result.current.turn?.move).toBe('U');
    expect(result.current.pending).toBe('second');
    expect(onSettled).not.toHaveBeenCalled();

    advanceTo(MS_PER_MOVE * 3);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith('second');
  });

  it('restarts the clock for the replacement turn', () => {
    const { result, onSettled } = setup();

    act(() => {
      result.current.start({ move: 'R', from: 0, to: 90, payload: 'first' });
    });
    advanceTo(MS_PER_MOVE * 0.9);

    act(() => {
      result.current.start({ move: 'U', from: 0, to: 90, payload: 'second' });
    });

    // The replacement gets a full turn of its own rather than inheriting what was left
    // of the one it interrupted.
    advanceTo(MS_PER_MOVE * 0.9 + MS_PER_MOVE * 0.5);
    expect(onSettled).not.toHaveBeenCalled();

    advanceTo(MS_PER_MOVE * 0.9 + MS_PER_MOVE + 40);
    expect(onSettled).toHaveBeenCalledWith('second');
  });

  it('drops a cancelled turn without committing it', () => {
    const { result, onSettled } = setup();

    act(() => {
      result.current.start({ move: 'R', from: 0, to: 90, payload: 'abandoned' });
    });
    advanceTo(MS_PER_MOVE / 2);

    act(() => {
      result.current.cancel();
    });

    expect(result.current.turn).toBeNull();
    expect(result.current.isTurning).toBe(false);

    advanceTo(MS_PER_MOVE * 3);
    expect(onSettled).not.toHaveBeenCalled();
  });

  /**
   * The callback is read through a ref. A caller that passes a fresh arrow function on
   * every render would otherwise restart the frame loop constantly, resetting the turn
   * already in progress.
   */
  it('does not restart the turn when the caller re-renders', () => {
    const settled = vi.fn();
    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) =>
        useTurnAnimation<string>({
          msPerMove: MS_PER_MOVE,
          now,
          onSettled: () => settled(tick),
        }),
      { initialProps: { tick: 0 } },
    );

    act(() => {
      result.current.start({ move: 'R', from: 0, to: 90, payload: 'one' });
    });
    advanceTo(MS_PER_MOVE / 2);

    const midway = result.current.turn?.angle ?? 0;
    rerender({ tick: 1 });

    // Still the same turn, at the same point, not restarted from zero.
    expect(result.current.turn?.angle).toBe(midway);

    advanceTo(MS_PER_MOVE + 40);
    // And the newest callback is the one that runs.
    expect(settled).toHaveBeenCalledWith(1);
  });
});
