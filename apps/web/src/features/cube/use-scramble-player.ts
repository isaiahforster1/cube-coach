import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyMoves, createSolvedCube, type CubeState, type Move } from '@cube-coach/shared';
import { fullAngle, quarterTurns } from './geometry.js';
import type { PartialTurn } from './CubeView.js';

export interface ScramblePlayerOptions {
  /** The scramble to play, from a solved cube. */
  readonly moves: readonly Move[];
  /** How long one quarter turn takes. */
  readonly msPerMove: number;
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

interface Animation {
  readonly move: Move;
  readonly from: number;
  readonly to: number;
  readonly startedAt: number;
  readonly durationMs: number;
  /** The move count once this animation finishes. */
  readonly indexAfter: number;
}

/**
 * A half turn sweeps twice as far, so giving it the same time makes it visibly whip
 * round. Not doubled either — that reads as a stall.
 */
function durationFor(move: Move, msPerMove: number): number {
  return Math.abs(quarterTurns(move)) === 2 ? msPerMove * 1.4 : msPerMove;
}

/** Slow at both ends, quick in the middle, the way a hand turns a layer. */
function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Plays a scramble one move at a time.
 *
 * The split here is the point: this hook owns *when* things happen and the engine owns
 * *what* the cube looks like. It never computes a cube position itself — it tracks how
 * many moves are done and asks `applyMoves` for the rest. So an animation bug can make
 * the cube look wrong for a moment, but it can never leave the cube in a position the
 * engine disagrees with.
 *
 * The animation is described as "the position after `index` moves, plus this much of
 * the next move". When a turn completes, `index` goes up by one and the partial turn is
 * dropped — and because a completed turn already looks exactly like the next position,
 * the swap is invisible.
 */
export function useScramblePlayer({
  moves,
  msPerMove,
  now,
}: ScramblePlayerOptions): ScramblePlayer {
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animation, setAnimation] = useState<Animation | null>(null);
  const [frameNow, setFrameNow] = useState(0);

  // The clock is read through a ref so that changing it does not restart the animation
  // loop, which would reset the turn already in progress.
  const clock = useRef(now);
  clock.current = now;
  const readNow = useCallback(
    () => (clock.current === undefined ? performance.now() : clock.current()),
    [],
  );

  // Derived from the move count, never stored. The position on screen therefore cannot
  // drift away from the moves that produced it.
  const state = useMemo(
    () => applyMoves(createSolvedCube(), moves.slice(0, index)),
    [moves, index],
  );

  /** Start again whenever the scramble itself changes. */
  useEffect(() => {
    setIndex(0);
    setAnimation(null);
    setIsPlaying(false);
  }, [moves]);

  const startTurn = useCallback(
    (move: Move, from: number, to: number, indexAfter: number) => {
      setAnimation({
        move,
        from,
        to,
        startedAt: readNow(),
        durationMs: durationFor(move, msPerMove),
        indexAfter,
      });
    },
    [msPerMove, readNow],
  );

  /** Run the turn in flight, frame by frame. */
  useEffect(() => {
    if (animation === null) return;

    let frame = 0;

    function tick(): void {
      // `animation` cannot be null here: the effect returns above if it is, and a
      // change to it tears this loop down.
      const current = animation as Animation;

      if (readNow() - current.startedAt >= current.durationMs) {
        setIndex(current.indexAfter);
        setAnimation(null);
        return;
      }

      setFrameNow(readNow());
      frame = requestAnimationFrame(tick);
    }

    // Draw the starting angle immediately rather than a frame late, which otherwise
    // shows one frame of the previous turn's final angle.
    setFrameNow(readNow());
    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [animation, readNow]);

  /**
   * Keep playing.
   *
   * Pausing deliberately does not abort the turn in flight — it just stops this from
   * queueing the next one. Cutting a move off half way would leave the cube in a
   * position that does not exist.
   */
  useEffect(() => {
    if (!isPlaying || animation !== null) return;

    const next = moves[index];
    if (next === undefined) {
      setIsPlaying(false);
      return;
    }

    startTurn(next, 0, fullAngle(next), index + 1);
  }, [isPlaying, animation, index, moves, startTurn]);

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
    setAnimation(null);
    setIndex(0);
  }, []);

  /**
   * Where a step should start from.
   *
   * If a turn is still in flight, it counts as done. Pressing "next" three times
   * quickly should move three moves on, not one — ignoring the presses until the
   * animation catches up makes the button feel broken, which is exactly how it felt
   * the first time this was tried in a browser.
   */
  const settled = animation === null ? index : animation.indexAfter;

  const stepForward = useCallback(() => {
    setIsPlaying(false);

    const next = moves[settled];
    if (next === undefined) {
      // Already at the end; just let the turn in flight land.
      setIndex(settled);
      setAnimation(null);
      return;
    }

    setIndex(settled);
    startTurn(next, 0, fullAngle(next), settled + 1);
  }, [moves, settled, startTurn]);

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
      setAnimation(null);
      return;
    }

    setIndex(settled - 1);
    startTurn(previous, fullAngle(previous), 0, settled - 1);
  }, [moves, settled, startTurn]);

  const turn: PartialTurn | null =
    animation === null
      ? null
      : {
          move: animation.move,
          angle:
            animation.from +
            (animation.to - animation.from) *
              ease(
                Math.min(1, Math.max(0, (frameNow - animation.startedAt) / animation.durationMs)),
              ),
        };

  return {
    state,
    turn,
    index,
    isPlaying,
    isFinished: settled >= moves.length,
    canStepBack: settled > 0,
    canStepForward: settled < moves.length,
    currentMove: animation === null ? null : Math.min(animation.indexAfter, index),
    play,
    pause,
    stepForward,
    stepBack,
    reset,
  };
}
