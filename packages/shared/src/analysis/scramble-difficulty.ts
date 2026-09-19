import type { Face, Move } from '../cube/types.js';
import { crossDifficulty } from './cross.js';

/**
 * How much work a scramble hands you before the solve has really begun.
 *
 * Measured as the length of the optimal cross, because that is the one part of a solve
 * the scramble dictates entirely: everything after the cross depends on choices the
 * solver makes, but the cross is a fixed, exactly computable cost. A "hard" scramble is
 * therefore a precise claim — the cross cannot be done in fewer than seven moves — not
 * a vibe.
 *
 * This is deliberately narrower than "how hard is this solve". A scramble can have a
 * four-move cross and an awful F2L, and this will still call it easy. The label says so
 * in the interface rather than pretending to measure more than it does.
 */
export type ScrambleDifficulty = 'easy' | 'standard' | 'hard';

export interface ScrambleRating {
  readonly difficulty: ScrambleDifficulty;
  /** Minimum moves to solve the cross. Exact, not estimated. */
  readonly crossMoves: number;
  /** The face the cross was measured on. */
  readonly face: Face;
}

/**
 * The cut-offs, chosen from the real distribution rather than picked by feel.
 *
 * Measuring optimal cross length over a large sample of random cubes gives roughly:
 *
 * ```
 *   ≤4 moves   7%     ← notably easy
 *    5 moves  26%
 *    6 moves  50%     ← the ordinary case
 *    7 moves  17%     ← notably hard
 *    8 moves   0.1%
 * ```
 *
 * So the tails are the interesting part, and a label is only worth showing when it
 * actually distinguishes this scramble from the last one. If every second scramble were
 * called hard, the word would stop meaning anything and people would stop reading it.
 *
 * Note this is a different split from the one {@link analyseCrossDifficulty} uses. That
 * one cuts the solves into two halves of comparable size, because it is doing statistics
 * and needs both groups populated. This one names the outliers. Same measurement, two
 * jobs.
 */
export const SCRAMBLE_DIFFICULTY_THRESHOLDS = {
  /** At or below this many cross moves, the scramble is notably easy. */
  easyAtOrBelow: 4,
  /** At or above this many cross moves, the scramble is notably hard. */
  hardAtOrAbove: 7,
} as const;

/** The default cross face, matching the rest of the analysis. */
export const DEFAULT_CROSS_FACE: Face = 'D';

/**
 * Rate a scramble by the length of its optimal cross.
 *
 * Measured on one face rather than the best of six. A colour-neutral solver would take
 * whichever cross is shortest, so the best-of-six number would describe them better —
 * but most people solve one colour, and a label that silently assumes otherwise would
 * tell them a scramble is easy when the cross they are actually going to solve is not.
 * Reporting the face keeps the claim checkable.
 */
export function rateScramble(
  moves: readonly Move[],
  face: Face = DEFAULT_CROSS_FACE,
): ScrambleRating {
  const crossMoves = crossDifficulty(moves, face);

  const difficulty: ScrambleDifficulty =
    crossMoves <= SCRAMBLE_DIFFICULTY_THRESHOLDS.easyAtOrBelow
      ? 'easy'
      : crossMoves >= SCRAMBLE_DIFFICULTY_THRESHOLDS.hardAtOrAbove
        ? 'hard'
        : 'standard';

  return { difficulty, crossMoves, face };
}
