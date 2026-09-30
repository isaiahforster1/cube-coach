/**
 * Independent checks on the solver's output, judged on the stickers (ADR-0021 §5).
 *
 * The solver reasons in a fixed frame, with piece readers and distance tables. These
 * predicates work the other way: they take the cube as it is actually held, after real
 * rotations, and compare stickers against the centres. They import nothing from the
 * solver or from `analysis/`, so a bug in one cannot hide the same bug in the other. The
 * one shared import is `held.ts`, which is vocabulary with no logic in it.
 */
import { at } from '../cube/permutations.js';
import type { CubeState } from '../cube/types.js';
import { HELD_SLOTS, type HeldSlot } from './held.js';

/** The centre of each face, by facelet index (see the layout in `cube/types.ts`). */
const CENTRE = { U: 4, R: 13, F: 22, D: 31, L: 40, B: 49 } as const;

/**
 * The four bottom edges as held: the sticker on the bottom face, and the sticker on the
 * side face next to it, with that side's centre.
 */
const BOTTOM_EDGES = [
  { bottom: 28, side: 25, sideCentre: CENTRE.F },
  { bottom: 32, side: 16, sideCentre: CENTRE.R },
  { bottom: 34, side: 52, sideCentre: CENTRE.B },
  { bottom: 30, side: 43, sideCentre: CENTRE.L },
] as const;

/**
 * True when the cross is solved on the bottom face as held, whatever colour that is.
 *
 * Each bottom edge must show the bottom centre's colour underneath and its side centre's
 * colour on the side. Matching the bottom alone is not enough: four bottom-coloured
 * stickers in a plus shape can still be a cross with two edges swapped.
 */
export function isCrossSolved(state: CubeState): boolean {
  const bottom = at(state, CENTRE.D);
  return BOTTOM_EDGES.every(
    (edge) =>
      at(state, edge.bottom) === bottom && at(state, edge.side) === at(state, edge.sideCentre),
  );
}

/**
 * Each held slot's stickers, with the centre each must match. Hand-entered from the layout
 * in `cube/types.ts` rather than taken from `analysis/`, so the oracle stays independent of
 * the piece readers. A test checks every entry on a solved cube.
 */
export const PAIR_STICKERS: Readonly<Record<HeldSlot, readonly (readonly [number, number])[]>> = {
  'front-right': [
    [29, CENTRE.D],
    [26, CENTRE.F],
    [15, CENTRE.R],
    [23, CENTRE.F],
    [12, CENTRE.R],
  ],
  'front-left': [
    [27, CENTRE.D],
    [24, CENTRE.F],
    [44, CENTRE.L],
    [21, CENTRE.F],
    [41, CENTRE.L],
  ],
  'back-right': [
    [35, CENTRE.D],
    [51, CENTRE.B],
    [17, CENTRE.R],
    [48, CENTRE.B],
    [14, CENTRE.R],
  ],
  'back-left': [
    [33, CENTRE.D],
    [53, CENTRE.B],
    [42, CENTRE.L],
    [50, CENTRE.B],
    [39, CENTRE.L],
  ],
};

/**
 * True when the pair in `slot`, as held, is solved: its bottom corner's three stickers and
 * its middle edge's two all match the centres they sit next to. Says nothing about the
 * cross, so a pair can be "solved" over a broken one; {@link isFirstTwoLayersSolved} checks both.
 */
export function isPairSolved(state: CubeState, slot: HeldSlot): boolean {
  return PAIR_STICKERS[slot].every(([facelet, centre]) => at(state, facelet) === at(state, centre));
}

/**
 * True when the cross and all four pairs are solved on the bottom as held. Between them
 * they cover the whole bottom face and the lower two rows of every side, and nothing else.
 */
export function isFirstTwoLayersSolved(state: CubeState): boolean {
  return isCrossSolved(state) && HELD_SLOTS.every((slot) => isPairSolved(state, slot));
}
