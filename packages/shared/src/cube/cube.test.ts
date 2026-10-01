import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyMove,
  applyMoves,
  applySequence,
  applyToken,
  createSolvedCube,
  fromFaceletString,
  isSolved,
  isSolvedUpToRotation,
  toFaceletString,
} from './cube.js';
import {
  invertAlgorithm,
  invertSequence,
  invertToken,
  parseAlgorithm,
  parseSequence,
} from './notation.js';
import { MOVE_PERMUTATIONS, ROTATION_PERMUTATIONS } from './permutations.js';
import {
  AXES,
  FACELET_COUNT,
  FACELETS_PER_FACE,
  FACES,
  type Face,
  type Move,
  type Rotation,
} from './types.js';

const ALL_MOVES = Object.keys(MOVE_PERMUTATIONS) as Move[];
const ALL_ROTATIONS = Object.keys(ROTATION_PERMUTATIONS) as Rotation[];
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

describe('whole-cube rotations', () => {
  const solved = createSolvedCube();
  const after = (sequence: string) => applySequence(solved, parseSequence(sequence));

  it.each(AXES)('%s returns to the start after four quarter turns', (axis) => {
    expect(isSolved(after(`${axis} ${axis} ${axis} ${axis}`))).toBe(true);
  });

  it.each(AXES)('%s followed by its prime returns to the start', (axis) => {
    expect(isSolved(after(`${axis} ${axis}'`))).toBe(true);
  });

  it.each(AXES)('%s three times equals its prime', (axis) => {
    expect(toFaceletString(after(`${axis} ${axis} ${axis}`))).toBe(
      toFaceletString(after(`${axis}'`)),
    );
  });

  it.each(ALL_ROTATIONS)(
    '%s leaves a solved cube solved up to rotation, but not solved',
    (rotation) => {
      // The timer must not count a rotated cube as solved, but the pieces are all home.
      const state = applyToken(solved, rotation);
      expect(isSolved(state)).toBe(false);
      expect(isSolvedUpToRotation(state)).toBe(true);
    },
  );

  it('a face turn is not solved up to rotation', () => {
    expect(isSolvedUpToRotation(applyMove(solved, 'R'))).toBe(false);
  });

  it('three perpendicular half turns cancel out', () => {
    expect(isSolved(after('x2 y2 z2'))).toBe(true);
  });

  it('reaches exactly the 24 orientations of the cube', () => {
    // The rotation group of a cube has order 24: any of six faces on top, then any of
    // four in front. A wrong strip would either break rigidity (more states) or collapse
    // two orientations into one (fewer).
    const seen = new Set([toFaceletString(solved)]);
    const queue = [solved];
    for (let state = queue.shift(); state !== undefined; state = queue.shift()) {
      for (const rotation of ALL_ROTATIONS) {
        const next = applyToken(state, rotation);
        const key = toFaceletString(next);
        if (!seen.has(key)) {
          seen.add(key);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(24);
  });
});

/**
 * Turning the cube, doing a face turn, and turning it back is the same as turning a
 * different face — the one that was in that position before the rotation. So after `x`
 * the front face is on top, and `x U x'` turns what was the front: `F`.
 *
 * These are the rotation equivalent of the identities above. They depend on how each
 * rotation interacts with every face, so a single reversed or misplaced middle-layer
 * strip breaks some of them even when every structural test passes.
 */
const CONJUGATES: readonly (readonly [Rotation, Face, Face])[] = [
  // x follows R: F → U → B → D → F
  ['x', 'U', 'F'],
  ['x', 'B', 'U'],
  ['x', 'D', 'B'],
  ['x', 'F', 'D'],
  ['x', 'R', 'R'],
  ['x', 'L', 'L'],
  // y follows U: F → L → B → R → F
  ['y', 'F', 'R'],
  ['y', 'L', 'F'],
  ['y', 'B', 'L'],
  ['y', 'R', 'B'],
  ['y', 'U', 'U'],
  ['y', 'D', 'D'],
  // z follows F: U → R → D → L → U
  ['z', 'U', 'L'],
  ['z', 'R', 'U'],
  ['z', 'D', 'R'],
  ['z', 'L', 'D'],
  ['z', 'F', 'F'],
  ['z', 'B', 'B'],
];

describe('rotations conjugate face turns', () => {
  it.each(CONJUGATES)('%s, then %s, then back again turns %s', (rotation, face, turned) => {
    const scrambled = applyMoves(createSolvedCube(), parseAlgorithm("R U2 F' L D B2 R'"));
    const conjugated = applySequence(scrambled, [rotation, face, invertToken(rotation)]);
    expect(toFaceletString(conjugated)).toBe(toFaceletString(applyMove(scrambled, turned)));
  });
});

describe('sequence properties', () => {
  const anyRotation = fc.constantFrom(...ALL_ROTATIONS);
  const anyToken = fc.oneof(anyMove, anyRotation);

  it('any sequence of turns and rotations followed by its inverse returns to solved', () => {
    fc.assert(
      fc.property(fc.array(anyToken, { maxLength: 40 }), (tokens) => {
        const state = applySequence(createSolvedCube(), tokens);
        return isSolved(applySequence(state, invertSequence(tokens)));
      }),
    );
  });

  it('rotations alone never unsolve the pieces', () => {
    fc.assert(
      fc.property(fc.array(anyRotation, { maxLength: 20 }), (rotations) => {
        return isSolvedUpToRotation(applySequence(createSolvedCube(), rotations));
      }),
    );
  });

  it('applyToken agrees with applyMove on every face turn', () => {
    fc.assert(
      fc.property(anyAlgorithm, (moves) => {
        const byMove = applyMoves(createSolvedCube(), moves);
        const byToken = applySequence(createSolvedCube(), moves);
        return toFaceletString(byMove) === toFaceletString(byToken);
      }),
    );
  });
});
