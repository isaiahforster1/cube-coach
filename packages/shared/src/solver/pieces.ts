/**
 * Piece-level move tables for the F2L search (ADR-0021 §4), promoted from the step-1
 * spike.
 *
 * A piece is tracked as one small integer, a "digit": `slot * 2 + flip` for an edge,
 * `slot * 3 + twist` for a corner. Both have 24 values. Each move is then a 24-entry
 * lookup per piece, so the search loop allocates nothing and never touches the 54
 * stickers. The tables are derived from the sticker model, not typed in, and a test checks
 * them against it for every move.
 */
import { applyMove, createSolvedCube } from '../cube/cube.js';
import { at } from '../cube/permutations.js';
import { FACES, TURNS, type CubeState, type Face, type Move } from '../cube/types.js';
import { readCorners } from '../analysis/corners.js';
import { EDGE_MOVES, readEdges } from '../analysis/edges.js';

/** The 18 face turns. A move's index into this list is how the search refers to it. */
export const ALL_MOVES: readonly Move[] = FACES.flatMap((face) =>
  TURNS.map((turn) => `${face}${turn}` as Move),
);

/** Values one digit can take: 12 edge slots × 2 flips, or 8 corner slots × 3 twists. */
export const DIGITS = 24;

/** `EDGE_DIGIT[m * 24 + d]`: where edge digit `d` goes under move `m`. */
export const EDGE_DIGIT = new Uint8Array(ALL_MOVES.length * DIGITS);
/** `CORNER_DIGIT[m * 24 + d]`: where corner digit `d` goes under move `m`. */
export const CORNER_DIGIT = new Uint8Array(ALL_MOVES.length * DIGITS);

/** Index into {@link FACES} of each move's face, for skipping redundant sequences. */
export const FACE_OF_MOVE: readonly number[] = ALL_MOVES.map((move) =>
  FACES.indexOf(move[0] as Face),
);

for (const [m, move] of ALL_MOVES.entries()) {
  const edge = EDGE_MOVES[move];
  for (let d = 0; d < DIGITS; d += 1) {
    const slot = d >> 1;
    EDGE_DIGIT[m * DIGITS + d] = at(edge.destination, slot) * 2 + ((d & 1) ^ at(edge.flip, slot));
  }

  // Derived the same way as EDGE_MOVES: apply the move to a solved cube and read where
  // each corner went. Twists add mod 3 because every slot reads its faces clockwise.
  const placements = readCorners(applyMove(createSolvedCube(), move));
  const destination = new Array<number>(8).fill(0);
  const twist = new Array<number>(8).fill(0);
  for (const [slot, placement] of placements.entries()) {
    destination[placement.piece] = slot;
    twist[placement.piece] = placement.orientation;
  }
  for (let d = 0; d < DIGITS; d += 1) {
    const slot = Math.floor(d / 3);
    CORNER_DIGIT[m * DIGITS + d] = at(destination, slot) * 3 + (((d % 3) + at(twist, slot)) % 3);
  }
}

/** Edge digits indexed by piece (its home slot), read from the stickers. */
export function edgeDigits(state: CubeState): number[] {
  const digits = new Array<number>(12).fill(0);
  for (const [slot, placement] of readEdges(state).entries()) {
    digits[placement.piece] = slot * 2 + placement.orientation;
  }
  return digits;
}

/** Corner digits indexed by piece (its home slot), read from the stickers. */
export function cornerDigits(state: CubeState): number[] {
  const digits = new Array<number>(8).fill(0);
  for (const [slot, placement] of readCorners(state).entries()) {
    digits[placement.piece] = slot * 3 + placement.orientation;
  }
  return digits;
}

/** `at` for typed arrays: fails loudly instead of returning `undefined`. Not for hot loops. */
export function byte(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined) throw new RangeError(`Index ${index} is out of bounds`);
  return value;
}
