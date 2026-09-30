/**
 * Words for where things are as the person holds the cube (ADR-0021, "Made harder").
 *
 * The solver has two ways to talk about one cube. A {@link Face} is a fixed label: it names
 * a centre and so a colour, and it never moves. A {@link HeldPosition} is a place: the top,
 * the front. After a rotation the `R` label can be at the front, so mixing the two gives an
 * explanation that is true but wrong for the reader.
 *
 * These are words, not letters, on purpose. If held positions were `'U' | 'R' | …` they
 * would be the same type as `Face`, and TypeScript would let one stand in for the other.
 * As words, passing a colour where a place is expected does not compile.
 *
 * This file is vocabulary only, with no logic, so the oracle can share it without sharing
 * a derivation with the solver.
 */
import type { Face } from '../cube/types.js';

/** In the same order as `FACES`, so position `i` is the `i`th block of nine stickers. */
export const HELD_POSITIONS = ['top', 'right', 'front', 'bottom', 'left', 'back'] as const;

export type HeldPosition = (typeof HELD_POSITIONS)[number];

/**
 * The letter that writes a turn of each held position. Notation is positional: `R` means
 * "turn whatever is on the right", which is why a presented `Move` is in held terms even
 * though its type says `Face`. This table is the one place the two meet.
 */
export const NOTATION_LETTER: Readonly<Record<HeldPosition, Face>> = {
  top: 'U',
  right: 'R',
  front: 'F',
  bottom: 'D',
  left: 'L',
  back: 'B',
};

/** An F2L slot as held, or the column above one: the two sides it sits between. */
export type HeldSlot = 'front-right' | 'front-left' | 'back-right' | 'back-left';

export const HELD_SLOTS: readonly HeldSlot[] = [
  'front-right',
  'front-left',
  'back-right',
  'back-left',
];

/**
 * The slot between two held sides, in either order. Throws for any pair that is not one
 * front-or-back side and one left-or-right side, since no slot lies between those.
 */
export function heldSlotBetween(a: HeldPosition, b: HeldPosition): HeldSlot {
  const depth = [a, b].find((p) => p === 'front' || p === 'back');
  const side = [a, b].find((p) => p === 'left' || p === 'right');
  if (depth === undefined || side === undefined) {
    throw new Error(`No slot lies between ${a} and ${b}`);
  }
  return `${depth}-${side}`;
}
