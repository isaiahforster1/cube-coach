import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyMoves, createSolvedCube } from '../cube/cube.js';
import { invertAlgorithm, parseAlgorithm } from '../cube/notation.js';
import { FACES, TURNS, type Face, type Move } from '../cube/types.js';
import { crossDifficulty, crossDifficultyByFace } from './cross.js';
import { EDGE_SLOTS, readEdges } from './edges.js';

const ALL_MOVES = FACES.flatMap((face) => TURNS.map((turn) => `${face}${turn}` as Move));

describe('edge slot table', () => {
  /**
   * Catches a mistyped facelet index immediately: on a solved cube, the slot named "UF"
   * must read a U sticker and an F sticker, and so on for all twelve.
   */
  it.each(EDGE_SLOTS)('slot $name reads its own two faces when solved', (slot) => {
    const solved = createSolvedCube();
    const [first, second] = slot.facelets;

    expect(`${solved[first]}${solved[second]}`).toBe(slot.name);
  });

  it('identifies every piece as being at home on a solved cube', () => {
    const placements = readEdges(createSolvedCube());

    expect(placements.map((p) => p.piece)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(placements.every((p) => p.orientation === 0)).toBe(true);
  });
});

describe('crossDifficulty', () => {
  it('is zero on a solved cube', () => {
    for (const face of FACES) {
      expect(crossDifficulty([], face)).toBe(0);
    }
  });

  it('is one after a single move that breaks only that cross', () => {
    // D moves all four D-cross edges; undoing it takes exactly one move.
    expect(crossDifficulty(parseAlgorithm('D'), 'D')).toBe(1);
    expect(crossDifficulty(parseAlgorithm("U'"), 'U')).toBe(1);
  });

  it('is unaffected by a move that does not touch the cross', () => {
    // U turns only the top layer, so the bottom cross is untouched.
    expect(crossDifficulty(parseAlgorithm('U'), 'D')).toBe(0);
    expect(crossDifficulty(parseAlgorithm('U2'), 'D')).toBe(0);
  });

  it('counts a two-move disruption as two', () => {
    expect(crossDifficulty(parseAlgorithm('R F'), 'D')).toBeLessThanOrEqual(2);
    expect(crossDifficulty(parseAlgorithm('R F'), 'D')).toBeGreaterThan(0);
  });

  /**
   * The property that proves the search is finding genuine optima: a scramble built from
   * n moves can never need more than n moves to undo.
   */
  it('never exceeds the number of moves used to scramble', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ALL_MOVES), { minLength: 0, maxLength: 6 }),
        fc.constantFrom(...FACES),
        (scramble, face) => crossDifficulty(scramble, face) <= scramble.length,
      ),
      { numRuns: 60 },
    );
  });

  /** A known upper bound for the cross on a 3x3: never more than eight moves. */
  it('never needs more than eight moves, however bad the scramble', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ALL_MOVES), { minLength: 15, maxLength: 25 }),
        (scramble) => crossDifficulty(scramble, 'D') <= 8,
      ),
      { numRuns: 40 },
    );
  });

  it('finds a genuinely optimal solution, not merely a valid one', () => {
    // Scrambling with three moves that each disturb the D cross, then asking for the
    // distance: it must be exactly three, since no shorter sequence can undo them.
    const scramble = parseAlgorithm('D R2 F2');
    const distance = crossDifficulty(scramble, 'D');

    expect(distance).toBeLessThanOrEqual(3);

    // And confirm by brute force that nothing shorter works.
    const solved = createSolvedCube();
    const state = applyMoves(solved, scramble);
    const crossSolvedIn = (moves: Move[]) => {
      const after = applyMoves(state, moves);
      const placements = readEdges(after);
      return EDGE_SLOTS.map((slot, index) => ({ slot, index }))
        .filter(({ slot }) => slot.name.includes('D'))
        .every(
          ({ index }) => placements[index]?.piece === index && placements[index]?.orientation === 0,
        );
    };

    let shortest = Infinity;
    for (const a of ALL_MOVES) {
      if (crossSolvedIn([a])) shortest = Math.min(shortest, 1);
      for (const b of ALL_MOVES) {
        if (crossSolvedIn([a, b])) shortest = Math.min(shortest, 2);
      }
    }

    expect(distance).toBe(Math.min(shortest, 3));
  });

  it('agrees with the inverse of a scramble being solvable in the same length', () => {
    const scramble = parseAlgorithm("R U R' F2 D");
    const inverse = invertAlgorithm(scramble);

    // Applying the scramble then its inverse returns to solved, so the cross distance
    // after both must be zero.
    expect(crossDifficulty([...scramble, ...inverse], 'D')).toBe(0);
  });
});

describe('crossDifficultyByFace', () => {
  it('reports a number for every face', () => {
    const difficulties = crossDifficultyByFace(parseAlgorithm("R U R' U' F2 D B L2"));

    expect(Object.keys(difficulties).sort()).toEqual([...FACES].sort());
    for (const face of FACES) {
      expect(difficulties[face as Face]).toBeGreaterThanOrEqual(0);
      expect(difficulties[face as Face]).toBeLessThanOrEqual(8);
    }
  });

  /**
   * The colour-neutrality insight in miniature: the easiest cross is usually meaningfully
   * shorter than the hardest, which is the advantage a colour-neutral solver gets for
   * free and a fixed-colour solver gives up.
   */
  it('shows the spread between the easiest and hardest cross', () => {
    const difficulties = crossDifficultyByFace(parseAlgorithm("D2 R U2 F' L B2 R' D F2 U"));
    const values = Object.values(difficulties);

    expect(Math.min(...values)).toBeLessThanOrEqual(Math.max(...values));
  });
});
