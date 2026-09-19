import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  applyMoves,
  createSolvedCube,
  isSolved,
  parseAlgorithm,
  type Move,
} from '@cube-coach/shared';
import { useScramblePlayer } from './use-scramble-player.js';

/**
 * A clock we control completely, so a twenty-move scramble plays through in
 * microseconds and no test depends on the machine being idle.
 */
let clock = 0;
const now = () => clock;

const MS_PER_MOVE = 400;

/**
 * Advance to a moment in time, letting the animation loop run as it goes.
 *
 * Deliberately in small steps rather than one jump. Each move ends inside an animation
 * frame and the *next* one is queued by an effect, which React only runs when `act`
 * returns — so a single large jump would play exactly one move however far it advanced.
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

function setup(notation: string, msPerMove = MS_PER_MOVE) {
  const moves: readonly Move[] = parseAlgorithm(notation);
  const rendered = renderHook(
    ({ m }: { m: readonly Move[] }) => useScramblePlayer({ moves: m, msPerMove, now }),
    { initialProps: { m: moves } },
  );
  return { ...rendered, moves };
}

describe('useScramblePlayer', () => {
  it('starts solved, with nothing turning', () => {
    const { result } = setup("R U R' U'");

    expect(isSolved(result.current.state)).toBe(true);
    expect(result.current.index).toBe(0);
    expect(result.current.turn).toBeNull();
    expect(result.current.isPlaying).toBe(false);
  });

  it('applies a move to the engine only once its turn has finished', () => {
    const { result } = setup('R U');

    act(() => {
      result.current.stepForward();
    });

    // Mid-turn the cube is still drawn in the old position, with a partial rotation on
    // top. That pairing is what makes the handover at the end invisible.
    advanceTo(MS_PER_MOVE / 2);
    expect(result.current.index).toBe(0);
    expect(isSolved(result.current.state)).toBe(true);
    expect(result.current.turn?.move).toBe('R');

    advanceTo(MS_PER_MOVE + 20);
    expect(result.current.index).toBe(1);
    expect(result.current.turn).toBeNull();
    expect(result.current.state).toEqual(applyMoves(createSolvedCube(), parseAlgorithm('R')));
  });

  it('sweeps the angle from nothing to a full quarter turn', () => {
    const { result } = setup('R');

    act(() => {
      result.current.stepForward();
    });

    expect(result.current.turn?.angle).toBe(0);

    advanceTo(MS_PER_MOVE / 2);
    const halfway = result.current.turn?.angle ?? 0;
    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(90);
  });

  it('turns a prime move the other way', () => {
    const { result } = setup("R'");

    act(() => {
      result.current.stepForward();
    });
    advanceTo(MS_PER_MOVE / 2);

    expect(result.current.turn?.angle).toBeLessThan(0);
  });

  it('gives a half turn longer, because it has twice as far to go', () => {
    const { result } = setup('R2');

    act(() => {
      result.current.stepForward();
    });

    // Still turning at the point a quarter turn would have finished.
    advanceTo(MS_PER_MOVE + 20);
    expect(result.current.index).toBe(0);

    advanceTo(MS_PER_MOVE * 1.4 + 20);
    expect(result.current.index).toBe(1);
  });

  it('plays the whole scramble and stops at the end', () => {
    const notation = "R U R' U' F2 L D";
    const { result, moves } = setup(notation);

    act(() => {
      result.current.play();
    });

    // Generously past the end: every move plus slack.
    advanceTo(MS_PER_MOVE * 2 * moves.length + 500);

    expect(result.current.index).toBe(moves.length);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isFinished).toBe(true);
    expect(result.current.state).toEqual(applyMoves(createSolvedCube(), moves));
  });

  /**
   * Pausing mid-move deliberately lets that move land. Stopping a layer at 40 degrees
   * would leave the cube in a position that does not exist, and the engine could not
   * describe it.
   */
  it('finishes the move in flight when paused, then goes no further', () => {
    const { result } = setup("R U R' U'");

    act(() => {
      result.current.play();
    });
    advanceTo(MS_PER_MOVE / 2);

    act(() => {
      result.current.pause();
    });
    advanceTo(MS_PER_MOVE + 50);

    expect(result.current.index).toBe(1);
    expect(result.current.turn).toBeNull();

    advanceTo(MS_PER_MOVE * 6);
    expect(result.current.index).toBe(1);
    expect(result.current.isPlaying).toBe(false);
  });

  it('steps backwards by unwinding the previous move', () => {
    const { result } = setup('R U');

    act(() => {
      result.current.stepForward();
    });
    advanceTo(MS_PER_MOVE + 20);
    expect(result.current.index).toBe(1);

    act(() => {
      result.current.stepBack();
    });

    // The position drops back at once and the move is drawn fully turned, then unwound.
    expect(result.current.index).toBe(0);
    expect(result.current.turn?.move).toBe('R');
    expect(result.current.turn?.angle).toBe(90);

    advanceTo(MS_PER_MOVE * 2 + 40);
    expect(result.current.turn).toBeNull();
    expect(isSolved(result.current.state)).toBe(true);
  });

  it('will not step back past the start', () => {
    const { result } = setup('R U');

    act(() => {
      result.current.stepBack();
    });

    expect(result.current.index).toBe(0);
    expect(result.current.turn).toBeNull();
  });

  /**
   * Found by clicking the button quickly in a browser: every press during a turn used
   * to be dropped, so three quick presses moved one move. The button looked broken.
   */
  it('moves on for every press, even while a turn is still running', () => {
    const { result } = setup("R U R' D");

    act(() => {
      result.current.stepForward();
    });
    advanceTo(MS_PER_MOVE / 4);

    for (let press = 0; press < 3; press += 1) {
      act(() => {
        result.current.stepForward();
      });
    }

    // Four presses, four moves started. Each interrupted turn counts as done, so the
    // last of them is the one now running.
    expect(result.current.index).toBe(3);
    expect(result.current.turn?.move).toBe('D');

    advanceTo(MS_PER_MOVE * 2);
    expect(result.current.index).toBe(4);
    expect(result.current.state).toEqual(
      applyMoves(createSolvedCube(), parseAlgorithm("R U R' D")),
    );
  });

  it('steps back through a turn in flight without losing a move', () => {
    const { result } = setup('R U D');

    act(() => {
      result.current.play();
    });
    advanceTo(MS_PER_MOVE * 2 + MS_PER_MOVE / 4);
    // Two moves done, the third turning.
    expect(result.current.index).toBe(2);

    act(() => {
      result.current.stepBack();
    });

    // The third move counts as done, so back goes to the position after two.
    expect(result.current.index).toBe(2);
    expect(result.current.turn?.move).toBe('D');
  });

  it('will not step forward past the end', () => {
    const { result } = setup('R');

    act(() => {
      result.current.stepForward();
    });
    advanceTo(MS_PER_MOVE + 20);

    act(() => {
      result.current.stepForward();
    });

    expect(result.current.index).toBe(1);
    expect(result.current.turn).toBeNull();
  });

  it('starts over when play is pressed at the end', () => {
    const { result } = setup('R U');

    act(() => {
      result.current.play();
    });
    advanceTo(MS_PER_MOVE * 6);
    expect(result.current.isFinished).toBe(true);

    act(() => {
      result.current.play();
    });

    expect(result.current.index).toBe(0);
  });

  it('resets to a solved cube', () => {
    const { result } = setup("R U R'");

    act(() => {
      result.current.play();
    });
    advanceTo(MS_PER_MOVE * 2 + 20);

    act(() => {
      result.current.reset();
    });

    expect(result.current.index).toBe(0);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.turn).toBeNull();
    expect(isSolved(result.current.state)).toBe(true);
  });

  /**
   * A new scramble arrives every solve. Carrying on from halfway through the last one
   * would show a position belonging to no scramble at all.
   */
  it('goes back to solved when the scramble changes', () => {
    const { result, rerender } = setup('R U D');

    act(() => {
      result.current.play();
    });
    advanceTo(MS_PER_MOVE * 2 + 20);
    expect(result.current.index).toBeGreaterThan(0);

    rerender({ m: parseAlgorithm("L' B") });

    expect(result.current.index).toBe(0);
    expect(result.current.isPlaying).toBe(false);
    expect(isSolved(result.current.state)).toBe(true);
  });

  it('names the move being played, so the notation can follow along', () => {
    const { result } = setup("R U'");

    act(() => {
      result.current.play();
    });
    advanceTo(MS_PER_MOVE / 2);
    expect(result.current.currentMove).toBe(0);

    advanceTo(MS_PER_MOVE * 1.5);
    expect(result.current.currentMove).toBe(1);

    advanceTo(MS_PER_MOVE * 5);
    expect(result.current.currentMove).toBeNull();
  });
});
