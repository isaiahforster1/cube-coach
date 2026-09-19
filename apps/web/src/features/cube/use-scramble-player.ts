import { useCallback, useEffect, useMemo, useState } from 'react';
import { applyMoves, createSolvedCube, type CubeState, type Move } from '@cube-coach/shared';
import { fullAngle } from './geometry.js';
import { useTurnAnimation } from './use-turn-animation.js';
import type { PartialTurn } from './CubeView.js';

export interface ScramblePlayerOptions {
  /** The scramble to play, from a solved cube. */
  readonly moves: readonly Move[];
  /** How long one quarter turn takes. */
  readonly msPerMove: number;
  /**
   * The position to play from. Defaults to a solved cube, which is what a scramble
   * starts from; an algorithm is played from the case it solves instead.
   */
  readonly from?: CubeState;
  /** Injectable clock, so tests can run a whole scramble in microseconds. */
  readonly now?: () => number;
}

export interface ScramblePlayer {
  /** The position to draw: the cube after `index` moves. */
  readonly state: CubeState;
  /** The turn currently in flight, to be drawn on top of `state`. */
  readonly turn: PartialTurn | null;
  /** How many moves have been applied. */
  readonly index: number;
  readonly isPlaying: boolean;
  readonly isFinished: boolean;
  /** Whether stepping is possible, allowing for a turn still in flight. */
  readonly canStepBack: boolean;
  readonly canStepForward: boolean;
  /** The move being played right now, if any — for highlighting the notation. */
  readonly currentMove: number | null;
  play: () => void;
  pause: () => void;
  stepForward: () => void;
  stepBack: () => void;
  reset: () => void;
}

/**
 * Plays a scramble one move at a time.
 *
 * The split here is the point: this owns *when* things happen and the engine owns *what*
 * the cube looks like. It never computes a cube position — it tracks how many moves are
 * done and asks `applyMoves` for the rest. So an animation bug can make the cube look
 * wrong for a moment, but it can never leave the cube in a position the engine disagrees
 * with.
 *
 * The animation is described as "the position after `index` moves, plus this much of the
 * next move". When a turn completes, `index` goes up by one and the partial turn is
 * dropped — and because a completed turn already looks exactly like the next position,
 * the swap is invisible.
 */
export function useScramblePlayer({
  moves,
  msPerMove,
  from,
  now,
}: ScramblePlayerOptions): ScramblePlayer {
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const animation = useTurnAnimation<number>({
    msPerMove,
    ...(now === undefined ? {} : { now }),
    // The payload is the move count once the turn lands, so committing it is one call.
    onSettled: setIndex,
  });

  /**
   * Where the next step starts from.
   *
   * A turn still in the air counts as done. Pressing "next" three times quickly should
   * move three moves on, not one — ignoring presses until the animation catches up makes
   * the button feel broken, which is exactly how it felt the first time this was tried
   * in a browser.
   */
  const settled = animation.pending ?? index;

  // Derived from the move count, never stored. The position on screen therefore cannot
  // drift away from the moves that produced it.
  // Memoised so an un-passed `from` does not build a fresh solved cube on every render
  // and invalidate the position below it.
  const origin = useMemo(() => from ?? createSolvedCube(), [from]);
  const state = useMemo(() => applyMoves(origin, moves.slice(0, index)), [origin, moves, index]);

  const { start, cancel } = animation;

  /** Start again whenever the sequence itself changes. */
  useEffect(() => {
    setIndex(0);
    setIsPlaying(false);
    cancel();
  }, [moves, cancel]);

  /**
   * Keep playing.
   *
   * Pausing deliberately does not abort the turn in flight — it just stops this from
   * queueing the next one. Cutting a move off half way would leave the cube in a
   * position that does not exist.
   */
  useEffect(() => {
    if (!isPlaying || animation.isTurning) return;

    const next = moves[index];
    if (next === undefined) {
      setIsPlaying(false);
      return;
    }

    start({ move: next, from: 0, to: fullAngle(next), payload: index + 1 });
  }, [isPlaying, animation.isTurning, index, moves, start]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const play = useCallback(() => {
    // Pressing play at the end starts over, which is what the button appears to offer.
    setIndex((current) => (current >= moves.length ? 0 : current));
    setIsPlaying(true);
  }, [moves.length]);

  const reset = useCallback(() => {
    setIsPlaying(false);
    cancel();
    setIndex(0);
  }, [cancel]);

  const stepForward = useCallback(() => {
    setIsPlaying(false);
    setIndex(settled);

    const next = moves[settled];
    if (next === undefined) {
      // Already at the end; just let the turn in flight land where it was going.
      cancel();
      return;
    }

    start({ move: next, from: 0, to: fullAngle(next), payload: settled + 1 });
  }, [cancel, moves, settled, start]);

  /**
   * Step back by un-turning the previous move.
   *
   * The position drops back immediately and the move is drawn at its full angle, then
   * unwound to zero — so the cube looks unchanged at the instant of the swap and then
   * visibly reverses. Showing the move running backwards is the whole point: it is how
   * someone works out what the notation meant.
   */
  const stepBack = useCallback(() => {
    setIsPlaying(false);

    const previous = moves[settled - 1];
    if (settled === 0 || previous === undefined) {
      setIndex(settled);
      cancel();
      return;
    }

    setIndex(settled - 1);
    start({ move: previous, from: fullAngle(previous), to: 0, payload: settled - 1 });
  }, [cancel, moves, settled, start]);

  return {
    state,
    turn: animation.turn,
    index,
    isPlaying,
    isFinished: settled >= moves.length,
    canStepBack: settled > 0,
    canStepForward: settled < moves.length,
    // Forward: `index` is the move being played. Backward: the move being unwound sits
    // at `settled - 1`, which is where `index` has already been put.
    currentMove: animation.isTurning ? Math.min(settled, index) : null,
    play,
    pause,
    stepForward,
    stepBack,
    reset,
  };
}
