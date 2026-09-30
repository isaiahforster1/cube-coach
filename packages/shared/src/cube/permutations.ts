import {
  AXES,
  FACELET_COUNT,
  FACELETS_PER_FACE,
  FACES,
  type Axis,
  type Face,
  type Move,
  type Rotation,
  type Token,
} from './types.js';

/**
 * A permutation describes a move as a lookup table.
 *
 * `permutation[i] === j` reads as: "after this move, position `i` holds whatever was
 * at position `j` before it". Expressing it as *where each position gets its value
 * from* (rather than where each value goes to) means applying a move is a single
 * `map` with no bookkeeping.
 */
export type Permutation = readonly number[];

/** Array index access that fails loudly instead of silently producing `undefined`. */
export function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new RangeError(`Index ${index} is out of bounds (length ${items.length})`);
  }
  return value;
}

/** The three stickers a turn carries from one face to the next. */
type Strip = readonly [number, number, number];

/**
 * For each face, the four neighbouring strips that a clockwise quarter turn cycles
 * through, in the order the stickers travel: the first strip's stickers end up in the
 * second strip's positions, and so on around to the first.
 *
 * Within a strip, the three indices are listed so that position `k` of one strip maps
 * to position `k` of the next. Some are listed in reverse index order because the
 * stickers change orientation as they travel around the cube — turning R carries the
 * *top* of the front column to the *back* of the top face, not to its front.
 *
 * These 24 numbers per face are the only hand-derived data in the engine. Everything
 * else is computed from them, and the tests check them against known identities that
 * would fail if any were wrong.
 */
const ADJACENT_STRIPS: Record<Face, readonly [Strip, Strip, Strip, Strip]> = {
  // R → F → L → B
  U: [
    [9, 10, 11],
    [18, 19, 20],
    [36, 37, 38],
    [45, 46, 47],
  ],
  // U → B → D → F
  R: [
    [2, 5, 8],
    [51, 48, 45],
    [29, 32, 35],
    [20, 23, 26],
  ],
  // U → R → D → L
  F: [
    [6, 7, 8],
    [9, 12, 15],
    [29, 28, 27],
    [44, 41, 38],
  ],
  // R → B → L → F
  D: [
    [15, 16, 17],
    [51, 52, 53],
    [42, 43, 44],
    [24, 25, 26],
  ],
  // U → F → D → B
  L: [
    [0, 3, 6],
    [18, 21, 24],
    [27, 30, 33],
    [53, 50, 47],
  ],
  // U → L → D → R
  B: [
    [0, 1, 2],
    [42, 39, 36],
    [35, 34, 33],
    [11, 14, 17],
  ],
};

/**
 * Where each sticker of a face comes from when that face itself turns clockwise.
 *
 * Reading a face left-to-right and top-to-bottom, a clockwise turn moves the
 * top-left sticker to the top-right, so the new top-right (index 2) takes the old
 * top-left (index 0). The centre never moves. Since every face is indexed as seen
 * from outside, the same table works for all six.
 */
const ROTATE_FACE_CLOCKWISE: readonly number[] = [6, 3, 0, 7, 4, 1, 8, 5, 2];

function identity(): number[] {
  return Array.from({ length: FACELET_COUNT }, (_, index) => index);
}

/** Shift four strips one step around their cycle, writing into `permutation`. */
function cycleStrips(permutation: number[], strips: readonly [Strip, Strip, Strip, Strip]): void {
  for (let s = 0; s < strips.length; s += 1) {
    const source = at(strips, s);
    const destination = at(strips, (s + 1) % strips.length);
    for (let k = 0; k < source.length; k += 1) {
      permutation[at(destination, k)] = at(source, k);
    }
  }
}

function buildQuarterTurn(face: Face): Permutation {
  // Start from the identity: every sticker the move does not touch stays put.
  const permutation = identity();

  // 1. The turning face spins in place.
  const offset = FACES.indexOf(face) * FACELETS_PER_FACE;
  for (let i = 0; i < FACELETS_PER_FACE; i += 1) {
    permutation[offset + i] = offset + at(ROTATE_FACE_CLOCKWISE, i);
  }

  // 2. The four surrounding strips shift one step around the face.
  cycleStrips(permutation, ADJACENT_STRIPS[face]);

  return permutation;
}

/**
 * Combine two permutations into one, as though `first` were applied and then `second`.
 *
 * Reading it out: the result's position `i` takes from `second[i]`, and whatever was
 * at `second[i]` came in turn from `first[second[i]]`.
 */
function compose(first: Permutation, second: Permutation): Permutation {
  return second.map((source) => at(first, source));
}

/**
 * Every move, derived from the six clockwise quarter turns.
 *
 * A half turn is a quarter turn twice, and an anticlockwise turn is a quarter turn
 * three times. Deriving them means there is only one place a mistake could hide,
 * instead of eighteen hand-written tables.
 */
export const MOVE_PERMUTATIONS: Record<Move, Permutation> = (() => {
  const table: Partial<Record<Move, Permutation>> = {};

  for (const face of FACES) {
    const quarter = buildQuarterTurn(face);
    const half = compose(quarter, quarter);

    table[face] = quarter;
    table[`${face}2`] = half;
    table[`${face}'`] = compose(half, quarter);
  }

  return table as Record<Move, Permutation>;
})();

/**
 * Each axis of rotation: the face a rotation follows, the face opposite it, and the
 * middle layer between them.
 *
 * The middle layer is four strips of three in exactly the format of
 * {@link ADJACENT_STRIPS}, in the order a clockwise turn of `follows` carries them.
 * Each strip lies beside the matching strip of `follows`, one step further into the
 * cube, and runs the same way. These 36 numbers are the only new hand-entered data that
 * rotations need, and the geometry test checks them. See ADR-0020.
 */
const AXIS_LAYERS: Record<
  Axis,
  { follows: Face; opposite: Face; middle: readonly [Strip, Strip, Strip, Strip] }
> = {
  // U → B → D → F, like R
  x: {
    follows: 'R',
    opposite: 'L',
    middle: [
      [1, 4, 7],
      [52, 49, 46],
      [28, 31, 34],
      [19, 22, 25],
    ],
  },
  // R → F → L → B, like U
  y: {
    follows: 'U',
    opposite: 'D',
    middle: [
      [12, 13, 14],
      [21, 22, 23],
      [39, 40, 41],
      [48, 49, 50],
    ],
  },
  // U → R → D → L, like F
  z: {
    follows: 'F',
    opposite: 'B',
    middle: [
      [3, 4, 5],
      [10, 13, 16],
      [32, 31, 30],
      [43, 40, 37],
    ],
  },
};

/**
 * A quarter rotation is three layers turning together: the face it follows, the middle
 * layer, and the opposite face turning the other way — `x` is R, the middle, and L'.
 *
 * The three layers share no stickers, so the order they are composed in does not matter.
 * Reusing the face turns means the only new data is the middle layer.
 */
function buildQuarterRotation(axis: Axis): Permutation {
  const { follows, opposite, middle } = AXIS_LAYERS[axis];

  const middleTurn = identity();
  cycleStrips(middleTurn, middle);

  return compose(
    compose(MOVE_PERMUTATIONS[follows], middleTurn),
    MOVE_PERMUTATIONS[`${opposite}'`],
  );
}

/** Every rotation, derived from the three quarter rotations the same way as face turns. */
export const ROTATION_PERMUTATIONS: Record<Rotation, Permutation> = (() => {
  const table: Partial<Record<Rotation, Permutation>> = {};

  for (const axis of AXES) {
    const quarter = buildQuarterRotation(axis);
    const half = compose(quarter, quarter);

    table[axis] = quarter;
    table[`${axis}2`] = half;
    table[`${axis}'`] = compose(half, quarter);
  }

  return table as Record<Rotation, Permutation>;
})();

/** Every face turn and rotation, so applying either is a single lookup. */
export const TOKEN_PERMUTATIONS: Record<Token, Permutation> = {
  ...MOVE_PERMUTATIONS,
  ...ROTATION_PERMUTATIONS,
};
