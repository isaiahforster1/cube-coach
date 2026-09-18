import { describe, expect, it } from 'vitest';
import { MOVE_PERMUTATIONS } from './permutations.js';
import { FACELET_COUNT, type Move } from './types.js';

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
