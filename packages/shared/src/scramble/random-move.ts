import { formatAlgorithm } from '../cube/notation.js';
import { FACES, TURNS, type Face, type Move } from '../cube/types.js';
import type { Scramble, ScrambleProvider } from './types.js';

/**
 * Which axis each face turns about. Faces on the same axis do not affect each other —
 * turning R then L is the same as turning L then R — which is what makes some move
 * sequences redundant.
 */
const AXIS: Record<Face, 'x' | 'y' | 'z'> = {
  R: 'x',
  L: 'x',
  U: 'y',
  D: 'y',
  F: 'z',
  B: 'z',
};

export interface RandomMoveOptions {
  /** How many moves to generate. 25 is the conventional length for this style. */
  readonly length?: number;
  /**
   * Source of randomness, returning a number in [0, 1).
   *
   * Injected rather than calling Math.random directly so tests can supply a seeded
   * generator and assert on exact output. Randomness is an input, not a hidden
   * dependency.
   */
  readonly random?: () => number;
}

/**
 * A scramble generator that strings together random turns.
 *
 * It filters out the two kinds of obviously wasted move:
 *
 * 1. The same face twice in a row — `R R` is just `R2`.
 * 2. A third consecutive move on one axis — `R L R` is just `R2 L`, because faces on
 *    the same axis commute.
 *
 * Filtering those makes the scramble *look* reasonable, but it does not make the
 * distribution uniform: some cube positions remain far more likely than others. This
 * is why competitions require random-state scrambles, and why this provider reports
 * its quality honestly instead of pretending to be equivalent.
 */
export function createRandomMoveScrambleProvider(
  options: RandomMoveOptions = {},
): ScrambleProvider {
  const { length = 25, random = Math.random } = options;

  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(`Scramble length must be a non-negative integer, received ${length}`);
  }

  function pick<T>(items: readonly T[]): T {
    const index = Math.floor(random() * items.length);
    const value = items[Math.min(index, items.length - 1)];
    if (value === undefined) {
      throw new RangeError('Cannot pick from an empty list');
    }
    return value;
  }

  function generateMoves(): Move[] {
    const moves: Move[] = [];
    let previous: Face | undefined;
    let beforePrevious: Face | undefined;

    while (moves.length < length) {
      const face = pick(FACES);

      if (face === previous) continue;
      if (
        previous !== undefined &&
        beforePrevious !== undefined &&
        AXIS[face] === AXIS[previous] &&
        AXIS[previous] === AXIS[beforePrevious]
      ) {
        continue;
      }

      moves.push(`${face}${pick(TURNS)}`);
      beforePrevious = previous;
      previous = face;
    }

    return moves;
  }

  return {
    quality: 'random-move',
    generate(): Promise<Scramble> {
      const moves = generateMoves();
      return Promise.resolve({
        moves,
        notation: formatAlgorithm(moves),
        quality: 'random-move',
      });
    },
  };
}
