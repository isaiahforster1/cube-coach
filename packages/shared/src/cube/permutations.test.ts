import { describe, expect, it } from 'vitest';
import { MOVE_PERMUTATIONS, ROTATION_PERMUTATIONS } from './permutations.js';
import { FACELET_COUNT, type Axis, type Move, type Rotation } from './types.js';

const ALL_MOVES = Object.keys(MOVE_PERMUTATIONS) as Move[];

describe('MOVE_PERMUTATIONS', () => {
  it('defines all 18 moves', () => {
    expect(ALL_MOVES).toHaveLength(18);
  });

  it.each(ALL_MOVES)('%s is a bijection over all 54 positions', (move) => {
    const permutation = MOVE_PERMUTATIONS[move];

    expect(permutation).toHaveLength(FACELET_COUNT);
    // A permutation must use every index exactly once. If it does not, some sticker
    // has been duplicated and another lost, which would corrupt the cube silently.
    expect(new Set(permutation).size).toBe(FACELET_COUNT);
    expect([...permutation].sort((a, b) => a - b)).toEqual(
      Array.from({ length: FACELET_COUNT }, (_, index) => index),
    );
  });

  it.each(ALL_MOVES)('%s leaves all six centres fixed', (move) => {
    const permutation = MOVE_PERMUTATIONS[move];
    // Centres are at index 4 of each face. They never move under face turns, which is
    // why the colour scheme of a cube is fixed by its centres.
    for (const centre of [4, 13, 22, 31, 40, 49]) {
      expect(permutation[centre]).toBe(centre);
    }
  });

  it.each(ALL_MOVES)('%s moves exactly 20 stickers', (move) => {
    const permutation = MOVE_PERMUTATIONS[move];
    const moved = permutation.filter((source, index) => source !== index);
    // A face turn touches 8 stickers on the turning face plus 12 on the four
    // neighbouring strips. The centre stays, so 20 of 21 in the layer move.
    expect(moved).toHaveLength(20);
  });
});

const ALL_ROTATIONS = Object.keys(ROTATION_PERMUTATIONS) as Rotation[];

/** The centre facelet of each face, in {@link FACES} order. */
const CENTRES = [4, 13, 22, 31, 40, 49];

/** The two centres a rotation turns about: the face it follows and the opposite face. */
const AXIS_CENTRES: Record<Axis, readonly number[]> = {
  x: [13, 40], // R, L
  y: [4, 31], // U, D
  z: [22, 49], // F, B
};

describe('ROTATION_PERMUTATIONS', () => {
  it('defines all 9 rotations', () => {
    expect(ALL_ROTATIONS).toHaveLength(9);
  });

  it.each(ALL_ROTATIONS)('%s is a bijection over all 54 positions', (rotation) => {
    const permutation = ROTATION_PERMUTATIONS[rotation];

    expect(permutation).toHaveLength(FACELET_COUNT);
    expect([...permutation].sort((a, b) => a - b)).toEqual(
      Array.from({ length: FACELET_COUNT }, (_, index) => index),
    );
  });

  it.each(ALL_ROTATIONS)(
    '%s fixes the two centres on its axis and moves the other four',
    (rotation) => {
      const permutation = ROTATION_PERMUTATIONS[rotation];
      const onAxis = AXIS_CENTRES[rotation[0] as Axis];

      for (const centre of CENTRES) {
        const fixed = permutation[centre] === centre;
        expect(fixed).toBe(onAxis.includes(centre));
      }
    },
  );

  it.each(ALL_ROTATIONS)('%s moves exactly 52 stickers', (rotation) => {
    const permutation = ROTATION_PERMUTATIONS[rotation];
    const moved = permutation.filter((source, index) => source !== index);
    // The whole cube turns, so every sticker moves except the two centres on the axis.
    // Even a half turn moves the rest: nothing but the axis is its own image.
    expect(moved).toHaveLength(52);
  });

  it.each(ALL_ROTATIONS)('%s only ever sends a centre to a centre', (rotation) => {
    // A rotation turns the cube rigidly, so centres, edges and corners each stay in
    // their own kind of position. A strip that strays off the middle layer breaks this.
    const permutation = ROTATION_PERMUTATIONS[rotation];
    for (const centre of CENTRES) {
      expect(CENTRES).toContain(permutation[centre]);
    }
  });
});
