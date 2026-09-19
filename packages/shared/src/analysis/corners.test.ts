import { describe, expect, it } from 'vitest';
import { applyMove, applyMoves, createSolvedCube } from '../cube/cube.js';
import { parseAlgorithm } from '../cube/notation.js';
import { FACES, TURNS, type Move } from '../cube/types.js';
import { CORNER_COUNT, CORNER_SLOTS, readCorners } from './corners.js';
import { readEdges } from './edges.js';

const ALL_MOVES: Move[] = FACES.flatMap((face) => TURNS.map((turn) => `${face}${turn}` as Move));

/** How many swaps a permutation is made of, modulo 2. */
function parityOf(permutation: readonly number[]): number {
  const seen = new Array<boolean>(permutation.length).fill(false);
  let swaps = 0;

  for (let start = 0; start < permutation.length; start += 1) {
    if (seen[start] === true) continue;

    let length = 0;
    let index = start;
    while (seen[index] !== true) {
      seen[index] = true;
      index = permutation[index] ?? 0;
      length += 1;
    }
    swaps += length - 1;
  }

  return swaps % 2;
}

describe('corner slots', () => {
  it('names eight corners', () => {
    expect(CORNER_SLOTS).toHaveLength(CORNER_COUNT);
    expect(CORNER_COUNT).toBe(8);
  });

  it('uses each facelet exactly once', () => {
    const facelets = CORNER_SLOTS.flatMap((slot) => slot.facelets);
    expect(new Set(facelets).size).toBe(facelets.length);
  });

  /** The check that each slot's three indices really are the corner its name claims. */
  it('reads each slot as its own faces on a solved cube', () => {
    const solved = createSolvedCube();

    for (const [index, slot] of CORNER_SLOTS.entries()) {
      const faces = slot.facelets.map((facelet) => solved[facelet]);
      expect(faces.join('')).toBe(slot.name);

      const placement = readCorners(solved)[index];
      expect(placement).toEqual({ piece: index, orientation: 0 });
    }
  });
});

describe('reading corners', () => {
  it('finds every piece exactly once, whatever the position', () => {
    const state = applyMoves(createSolvedCube(), parseAlgorithm("R U R' U' F2 L D B' R2 U"));
    const pieces = readCorners(state).map((placement) => placement.piece);

    expect([...pieces].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('sees a corner arrive twisted', () => {
    // A sexy move twists two corners in place among other things, so the top layer
    // cannot be all upright.
    const state = applyMoves(createSolvedCube(), parseAlgorithm("R U R' U' R U R' U'"));
    const twists = readCorners(state).map((placement) => placement.orientation);

    expect(twists.some((twist) => twist !== 0)).toBe(true);
  });
});

/**
 * The invariants of a physical cube. They hold for every sequence of moves because they
 * hold for every move, and a single slot listed the wrong way round breaks them
 * immediately — which is the only practical way to check a hand-entered clockwise
 * ordering.
 */
describe('cube invariants', () => {
  it.each(ALL_MOVES)('leaves the total corner twist divisible by three after %s', (move) => {
    const corners = readCorners(applyMove(createSolvedCube(), move));
    const total = corners.reduce((sum, corner) => sum + corner.orientation, 0);

    expect(total % 3).toBe(0);
  });

  it('keeps the total corner twist divisible by three through a long scramble', () => {
    const state = applyMoves(
      createSolvedCube(),
      parseAlgorithm("R U2 D' B D' F2 L' U' R B2 D2 F' L2 B R' U D2 F"),
    );
    const total = readCorners(state).reduce((sum, corner) => sum + corner.orientation, 0);

    expect(total % 3).toBe(0);
  });

  it.each(ALL_MOVES)('leaves the total edge flip even after %s', (move) => {
    const edges = readEdges(applyMove(createSolvedCube(), move));
    const total = edges.reduce((sum, edge) => sum + edge.orientation, 0);

    expect(total % 2).toBe(0);
  });

  /**
   * A single face turn is a four-cycle of corners and a four-cycle of edges — both odd
   * — so the two permutations always have the same parity. This is why a single swapped
   * pair is impossible on a real cube.
   */
  it.each(ALL_MOVES)('permutes corners and edges with matching parity after %s', (move) => {
    const state = applyMove(createSolvedCube(), move);

    const corners = readCorners(state).map((placement) => placement.piece);
    const edges = readEdges(state).map((placement) => placement.piece);

    expect(parityOf(corners)).toBe(parityOf(edges));
  });
});
