import { useCallback, useEffect, useRef, useState } from 'react';
import type { Move } from '@cube-coach/shared';
import { quarterTurns } from './geometry.js';
import type { PartialTurn } from './CubeView.js';

export interface TurnRequest<T> {
  readonly move: Move;
  /** The angle the layer starts at, in degrees. */
  readonly from: number;
  /** The angle it finishes at. Signed, so a prime turn winds the other way. */
  readonly to: number;
  /**
   * What the caller intends to commit once this turn lands. The hook never interprets
   * it; it hands it back on completion, and exposes it as `pending` meanwhile so the
   * caller can account for a turn that is still in the air.
   */
  readonly payload: T;
}

export interface TurnAnimation<T> {
  /** The turn to draw on top of the current position, or null when nothing is moving. */
  readonly turn: PartialTurn | null;
  readonly isTurning: boolean;
  /** The payload of the turn in flight, or null. */
  readonly pending: T | null;
  /** Begin a turn, replacing any turn already running without committing it. */
  start: (request: TurnRequest<T>) => void;
  /** Drop the turn in flight. Its payload is never committed. */
  cancel: () => void;
}

interface Running<T> {
  readonly move: Move;
  readonly from: number;
  readonly to: number;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly payload: T;
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
 * Turns one layer over time, and nothing else.
 *
 * This owns only the clock: which move, how far through it is, and when it lands. It has
 * no idea what a scramble or a move history is, which is what lets the scramble player
 * and the move playground share it — they have completely different notions of "where
 * the cube is" and exactly the same notion of "a layer is turning".
 *
 * The caller keeps owning the position. When a turn lands, the hook hands back the
 * payload and the caller updates its own state; the hook itself never touches a cube.
 * That is deliberate: the engine stays the only authority on where stickers are, and an
 * animation bug can never leave the cube in a position that does not exist.
 *
 * Starting a turn while one is running replaces it rather than queueing or refusing.
 * Refusing is what the first version did, and pressing a button three times quickly
 * moved the cube once, which felt broken. Callers fold `pending` into their own state
 * before starting the next turn, so nothing is lost.
 */
export function useTurnAnimation<T>({
  msPerMove,
  now,
  onSettled,
}: {
  readonly msPerMove: number;
  /** Injectable clock, so tests can run a whole scramble in microseconds. */
  readonly now?: () => number;
  /** Runs when a turn reaches its end. Not called for a replaced or cancelled turn. */
  readonly onSettled: (payload: T) => void;
}): TurnAnimation<T> {
  const [running, setRunning] = useState<Running<T> | null>(null);
  const [frameNow, setFrameNow] = useState(0);

  // Both of these are read through refs so that a caller passing a fresh function or
  // clock on every render does not restart the frame loop, which would reset the turn
  // already in progress.
  const clock = useRef(now);
  clock.current = now;
  const settled = useRef(onSettled);
  settled.current = onSettled;

  const readNow = useCallback(
    () => (clock.current === undefined ? performance.now() : clock.current()),
    [],
  );

  useEffect(() => {
    if (running === null) return;

    let frame = 0;

    function tick(): void {
      // `running` cannot be null here: the effect returns above if it is, and any change
      // to it tears this loop down.
      const current = running as Running<T>;

      if (readNow() - current.startedAt >= current.durationMs) {
        setRunning(null);
        settled.current(current.payload);
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
  }, [running, readNow]);

  const start = useCallback(
    ({ move, from, to, payload }: TurnRequest<T>) => {
      setRunning({
        move,
        from,
        to,
        startedAt: readNow(),
        durationMs: durationFor(move, msPerMove),
        payload,
      });
    },
    [msPerMove, readNow],
  );

  const cancel = useCallback(() => {
    setRunning(null);
  }, []);

  const turn: PartialTurn | null =
    running === null
      ? null
      : {
          move: running.move,
          angle:
            running.from +
            (running.to - running.from) *
              ease(Math.min(1, Math.max(0, (frameNow - running.startedAt) / running.durationMs))),
        };

  return {
    turn,
    isTurning: running !== null,
    pending: running === null ? null : running.payload,
    start,
    cancel,
  };
}
