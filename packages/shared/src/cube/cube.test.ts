import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyMove,
  applyMoves,
  createSolvedCube,
  fromFaceletString,
  isSolved,
  toFaceletString,
} from './cube.js';
import { invertAlgorithm, parseAlgorithm } from './notation.js';
import { MOVE_PERMUTATIONS } from './permutations.js';
import { FACELET_COUNT, FACELETS_PER_FACE, FACES, type Move } from './types.js';

const ALL_MOVES = Object.keys(MOVE_PERMUTATIONS) as Move[];
const anyMove = fc.constantFrom(...ALL_MOVES);
const anyAlgorithm = fc.array(anyMove, { minLength: 0, maxLength: 40 });

/** Repeat a sequence `times` times, starting from solved. */
function repeat(algorithm: string, times: number) {
  const moves = parseAlgorithm(algorithm);
  let state = createSolvedCube();
  for (let i = 0; i < times; i += 1) {
    state = applyMoves(state, moves);
  }
  return state;
}

describe('createSolvedCube', () => {
  it('has 54 facelets', () => {
    expect(createSolvedCube()).toHaveLength(FACELET_COUNT);
  });

  it('has nine of each face', () => {
    const state = createSolvedCube();
    for (const face of FACES) {
      expect(state.filter((facelet) => facelet === face)).toHaveLength(FACELETS_PER_FACE);
    }
  });

  it('is solved', () => {
    expect(isSolved(createSolvedCube())).toBe(true);
  });
});

describe('applyMove', () => {
  it('does not mutate the state it is given', () => {
    const state = createSolvedCube();
    const before = toFaceletString(state);
    applyMove(state, 'R');
    expect(toFaceletString(state)).toBe(before);
  });

  it('changes the cube', () => {
    expect(isSolved(applyMove(createSolvedCube(), 'R'))).toBe(false);
  });

  it.each(ALL_MOVES)('%s leaves nine of each face', (move) => {
    const state = applyMove(createSolvedCube(), move);
    for (const face of FACES) {
      expect(state.filter((facelet) => facelet === face)).toHaveLength(FACELETS_PER_FACE);
    }
  });

  it.each(FACES)('%s returns to solved after four quarter turns', (face) => {
    expect(isSolved(repeat(`${face} ${face} ${face} ${face}`, 1))).toBe(true);
  });

  it.each(FACES)('%s2 returns to solved after two half turns', (face) => {
    expect(isSolved(repeat(`${face}2 ${face}2`, 1))).toBe(true);
  });

  it.each(FACES)('%s followed by its prime returns to solved', (face) => {
    expect(isSolved(repeat(`${face} ${face}'`, 1))).toBe(true);
  });

  it.each(FACES)('%s and %s2 are consistent: three quarters equals prime', (face) => {
    const threeQuarters = repeat(`${face} ${face} ${face}`, 1);
    const prime = repeat(`${face}'`, 1);
    expect(toFaceletString(threeQuarters)).toBe(toFaceletString(prime));
  });
});

/**
 * These are the tests that prove the hand-derived permutation tables are right.
 *
 * The identities above (four quarter turns returns to solved) would pass even with
 * wrong-but-consistent tables, because any 4-cycle satisfies them. The identities
 * below depend on how two *different* faces interact, so they fail if a single strip
 * is listed in the wrong order or attached to the wrong neighbour.
 */
describe('known cube identities', () => {
  it('six sexy moves return to solved', () => {
    expect(isSolved(repeat("R U R' U'", 6))).toBe(true);
  });

  it('fewer than six sexy moves do not', () => {
    for (let times = 1; times < 6; times += 1) {
      expect(isSolved(repeat("R U R' U'", times))).toBe(false);
    }
  });

  it('the T permutation is its own inverse', () => {
    expect(isSolved(repeat("R U R' U' R' F R2 U' R' U' R U R' F'", 2))).toBe(true);
  });

  it('a Sune repeated six times returns to solved', () => {
    expect(isSolved(repeat("R U R' U R U2 R'", 6))).toBe(true);
  });
});

describe('facelet strings', () => {
  it('round-trips a solved cube', () => {
    const solved = createSolvedCube();
    expect(fromFaceletString(toFaceletString(solved))).toEqual(solved);
  });

  it('round-trips a scrambled cube', () => {
    const scrambled = applyMoves(createSolvedCube(), parseAlgorithm("R U2 F' L D B2"));
    expect(fromFaceletString(toFaceletString(scrambled))).toEqual(scrambled);
  });

  it('rejects the wrong length', () => {
    expect(() => fromFaceletString('UUU')).toThrow(/Expected 54 facelets/u);
  });

  it('rejects unknown characters', () => {
    expect(() => fromFaceletString('X'.repeat(54))).toThrow(/Invalid facelet/u);
  });

  it('rejects a miscounted face', () => {
    const oneStickerWrong = 'R' + toFaceletString(createSolvedCube()).slice(1);
    expect(() => fromFaceletString(oneStickerWrong)).toThrow(/Expected 9 'U' facelets, found 8/u);
  });
});

describe('properties', () => {
  it('any algorithm followed by its inverse returns to solved', () => {
    fc.assert(
      fc.property(anyAlgorithm, (moves) => {
        const scrambled = applyMoves(createSolvedCube(), moves);
        return isSolved(applyMoves(scrambled, invertAlgorithm(moves)));
      }),
    );
  });

  it('any algorithm preserves nine of each face', () => {
    fc.assert(
      fc.property(anyAlgorithm, (moves) => {
        const state = applyMoves(createSolvedCube(), moves);
        return FACES.every(
          (face) => state.filter((facelet) => facelet === face).length === FACELETS_PER_FACE,
        );
      }),
    );
  });

  it('only the identity algorithm leaves a solved cube solved', () => {
    fc.assert(
      fc.property(fc.array(anyMove, { minLength: 1, maxLength: 1 }), (moves) => {
        return !isSolved(applyMoves(createSolvedCube(), moves));
      }),
    );
  });
});
