import { describe, expect, it } from 'vitest';
import { MOVE_PERMUTATIONS } from './permutations.js';
import { FACELET_COUNT, FACELETS_PER_FACE, FACES, type Face } from './types.js';

/**
 * An independent check on the hand-entered strip tables in permutations.ts.
 *
 * Those tables are fast and explicit, but they are 24 numbers per face that a human
 * typed, and a single reversed strip produces a cube that is subtly wrong while still
 * passing every structural test. So this file rebuilds the same permutations from 3D
 * geometry — rotating sticker positions about an axis — and asserts the two agree.
 *
 * Two derivations by different methods agreeing is much stronger evidence than either
 * alone. If someone edits the tables by hand later, this fails immediately.
 */

type Vector = readonly [number, number, number];

interface FaceFrame {
  /** Outward normal of the face. */
  readonly normal: Vector;
  /** Which direction is "up" when reading that face's stickers. */
  readonly up: Vector;
  /** Which direction is "right" when reading that face's stickers. */
  readonly right: Vector;
}

const FRAMES: Record<Face, FaceFrame> = {
  U: { normal: [0, 1, 0], up: [0, 0, -1], right: [1, 0, 0] },
  R: { normal: [1, 0, 0], up: [0, 1, 0], right: [0, 0, -1] },
  F: { normal: [0, 0, 1], up: [0, 1, 0], right: [1, 0, 0] },
  D: { normal: [0, -1, 0], up: [0, 0, 1], right: [1, 0, 0] },
  L: { normal: [-1, 0, 0], up: [0, 1, 0], right: [0, 0, 1] },
  B: { normal: [0, 0, -1], up: [0, 1, 0], right: [-1, 0, 0] },
};

const dot = (a: Vector, b: Vector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The facelet index of the sticker on cubie `position` whose outward normal is `normal`. */
function faceletIndex(position: Vector, normal: Vector): number {
  const face = FACES.find((candidate) => dot(FRAMES[candidate].normal, normal) === 1);
  if (face === undefined) throw new Error(`No face has normal ${normal.join(',')}`);

  const frame = FRAMES[face];
  const row = 1 - dot(position, frame.up);
  const column = dot(position, frame.right) + 1;
  return FACES.indexOf(face) * FACELETS_PER_FACE + row * 3 + column;
}

/**
 * Rotate `vector` a quarter turn clockwise about `axis`, viewed from outside that face.
 *
 * Only the component perpendicular to the axis turns; the component along the axis is
 * unchanged, which is what keeps a cubie inside its own layer.
 */
function rotate(vector: Vector, axis: Vector): Vector {
  const axial = dot(vector, axis);
  const p: Vector = [
    vector[0] - axis[0] * axial,
    vector[1] - axis[1] * axial,
    vector[2] - axis[2] * axial,
  ];
  const turned: Vector = [
    p[1] * axis[2] - p[2] * axis[1],
    p[2] * axis[0] - p[0] * axis[2],
    p[0] * axis[1] - p[1] * axis[0],
  ];
  return [turned[0] + axis[0] * axial, turned[1] + axis[1] * axial, turned[2] + axis[2] * axial];
}

const NORMALS: readonly Vector[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** Build a clockwise quarter turn of `face` purely from geometry. */
function quarterTurnFromGeometry(face: Face): number[] {
  const axis = FRAMES[face].normal;
  const permutation = Array.from({ length: FACELET_COUNT }, (_, index) => index);

  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        const position: Vector = [x, y, z];
        if (dot(position, axis) !== 1) continue; // not in the turning layer

        for (const normal of NORMALS) {
          if (dot(position, normal) !== 1) continue; // sticker is not on the surface
          const from = faceletIndex(position, normal);
          const to = faceletIndex(rotate(position, axis), rotate(normal, axis));
          permutation[to] = from;
        }
      }
    }
  }

  return permutation;
}

describe('permutation tables agree with 3D geometry', () => {
  it('a clockwise U sends the front face to the left', () => {
    // Guards the rotation direction itself: get this backwards and every table is
    // the mirror image of the truth, while still passing every structural test.
    expect(rotate([0, 0, 1], [0, 1, 0])).toEqual([-1, 0, 0]);
  });

  it.each(FACES)('%s matches the geometric derivation', (face) => {
    expect(MOVE_PERMUTATIONS[face]).toEqual(quarterTurnFromGeometry(face));
  });
});
