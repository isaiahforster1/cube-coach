import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crossDifficulty, crossDistance } from '../analysis/cross.js';
import { applyMove, applyMoves, applySequence, createSolvedCube } from '../cube/cube.js';
import { at } from '../cube/permutations.js';
import { invertSequence, invertToken, isRotation, parseAlgorithm } from '../cube/notation.js';
import {
  FACES,
  TURNS,
  type CubeState,
  type Face,
  type Move,
  type Rotation,
  type Token,
} from '../cube/types.js';
import { heldCost, solveCross, type CrossStep } from './cross.js';
import { frameOf, present, SCRAMBLE_FRAME, type Frame } from './frame.js';
import { isCrossSolved } from './oracle.js';

const ALL_MOVES = FACES.flatMap((face) => TURNS.map((turn) => `${face}${turn}` as Move));

/** Seeded, so a failure names a scramble that can be replayed. */
const SCRAMBLES: Move[][] = fc.sample(
  fc.array(fc.constantFrom(...ALL_MOVES), { minLength: 20, maxLength: 25 }),
  { numRuns: 100, seed: 21 },
);

const scrambled = (scramble: readonly Move[]) => applyMoves(createSolvedCube(), scramble);

/**
 * The oracle's verdict on a presented step: perform the tokens on the real cube, rotations
 * and all, then judge on the stickers. A cross in the right colour on the bottom as held.
 */
function oracleAccepts(start: CubeState, tokens: readonly Token[], face: Face): boolean {
  const held = applySequence(start, tokens);
  return isCrossSolved(held) && held[31] === face;
}

describe('solveCross', () => {
  it('does nothing on a solved cube', () => {
    const step = solveCross(createSolvedCube());

    expect(step.moves).toEqual([]);
    expect(step.tokens).toEqual([]);
  });

  it('undoes a single move, as held', () => {
    // A U cross is held with z2, so the fixed U layer is performed as the held bottom.
    const step = solveCross(scrambled(parseAlgorithm('U')), 'U');

    expect(step.moves).toEqual(["U'"]);
    expect(step.tokens).toEqual(['z2', "D'"]);
  });

  it('gives the same answer every time', () => {
    const start = scrambled(at(SCRAMBLES, 0));

    expect(solveCross(start, 'F')).toEqual(solveCross(start, 'F'));
  });

  describe.each(FACES)('on the %s cross, over 100 seeded scrambles', (face) => {
    const steps = SCRAMBLES.map((scramble) => ({
      scramble,
      step: solveCross(scrambled(scramble), face),
    }));

    it('is optimal: as long as crossDifficulty says', () => {
      for (const { scramble, step } of steps) {
        expect(step.moves.length).toBe(crossDifficulty(scramble, face));
      }
    });

    it('is accepted by the sticker oracle when performed as shown', () => {
      for (const { scramble, step } of steps) {
        expect(oracleAccepts(scrambled(scramble), step.tokens, face)).toBe(true);
      }
    });

    it('shows the setup rotation first and no rotation after it', () => {
      for (const { step } of steps) {
        expect(step.tokens.slice(0, step.setup.length)).toEqual(step.setup);
        expect(step.tokens.slice(step.setup.length).some(isRotation)).toBe(false);
      }
    });

    /**
     * Re-derives the tie-break: at every point, no other move that also makes progress
     * would have been cheaper as held.
     */
    it('takes the cheapest move, as held, among those that make progress', () => {
      for (const { scramble, step } of steps) {
        let state = scrambled(scramble);
        for (const chosen of step.moves) {
          const target = crossDistance(state, face) - 1;
          const cheapest = Math.min(
            ...ALL_MOVES.filter((m) => crossDistance(applyMove(state, m), face) === target).map(
              (m) => heldCost(m, step.frame),
            ),
          );
          expect(heldCost(chosen, step.frame)).toBe(cheapest);
          state = applyMove(state, chosen);
        }
      }
    });
  });

  it('ranks every held face, with R U F L cheaper than D and B', () => {
    const cost = (face: Face) => heldCost(face, SCRAMBLE_FRAME);

    expect(new Set(FACES.map(cost)).size).toBe(6);
    for (const cheap of ['R', 'U', 'F', 'L'] as const) {
      expect(cost(cheap)).toBeLessThan(cost('D'));
      expect(cost(cheap)).toBeLessThan(cost('B'));
    }
  });
});

/**
 * Mutation check (ADR-0021 §5). Break the translation on purpose and confirm the oracle
 * notices. A suite that has only ever passed has not shown that it can fail.
 *
 * Each mutation re-presents the solver's correct fixed-frame moves through a wrong frame.
 * A mutation can change the tokens and still do no harm: swapping R and L turns `R L`
 * into `L R`, which is the same thing because opposite faces commute. So the claim is
 * about effects, not strings: the oracle lets a mutated answer through only when it moves
 * every piece exactly as the correct one does, and it rejects the mutation many times.
 */
describe('mutation check: a broken translation is caught by the oracle', () => {
  /** Where the pieces end up, with the answer's own rotations undone so grips compare equal. */
  const piecesAfter = (start: CubeState, tokens: readonly Token[]) =>
    applySequence(start, [
      ...tokens,
      ...invertSequence(tokens.filter((token): token is Rotation => isRotation(token))),
    ]);

  const swapHeld = (frame: Frame, a: Face, b: Face): Frame => ({
    ...frame,
    heldPositionOf: {
      ...frame.heldPositionOf,
      [a]: frame.heldPositionOf[b],
      [b]: frame.heldPositionOf[a],
    },
  });

  const mutations: Record<string, (step: CrossStep) => Token[]> = {
    // Translating with the inverse of the setup rotation. z2 is its own inverse, so this
    // is a no-op for U and D and is caught on the other four faces.
    'inverted frame': (step) =>
      present(
        step.moves,
        step.setup,
        frameOf([...step.setup].reverse().map((r) => invertToken(r))),
      ),
    // One pair of faces relabelled the wrong way round.
    'R and L swapped': (step) => present(step.moves, step.setup, swapHeld(step.frame, 'R', 'L')),
    // The rotation shown and the rotation translated with disagree.
    'x2 shown, z2 used': (step) =>
      step.face === 'U' ? ['x2', ...step.tokens.slice(1)] : [...step.tokens],
  };

  it.each(Object.keys(mutations))('%s', (name) => {
    const mutate = mutations[name] ?? (() => []);
    let rejected = 0;

    for (const face of FACES) {
      for (const scramble of SCRAMBLES) {
        const start = scrambled(scramble);
        const step = solveCross(start, face);
        const tokens = mutate(step);

        if (oracleAccepts(start, tokens, face)) {
          expect(piecesAfter(start, tokens), tokens.join(' ')).toEqual(
            piecesAfter(start, step.tokens),
          );
        } else {
          rejected += 1;
        }
      }
    }

    // Not vacuous: the oracle had to catch the mutation on a good share of 600 solves.
    expect(rejected).toBeGreaterThan(50);
  });
});
