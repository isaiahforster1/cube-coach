import { describe, expect, it } from 'vitest';
import { applyMoves, createSolvedCube, isSolved } from '../cube/cube.js';
import { isMove, parseAlgorithm } from '../cube/notation.js';
import type { Face } from '../cube/types.js';
import { createRandomMoveScrambleProvider } from './random-move.js';

/**
 * A small seeded generator, so tests are deterministic. Math.random cannot be used
 * here: a test that fails one run in fifty is worse than no test at all.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AXIS: Record<Face, string> = { R: 'x', L: 'x', U: 'y', D: 'y', F: 'z', B: 'z' };

describe('createRandomMoveScrambleProvider', () => {
  it('reports its quality honestly', () => {
    expect(createRandomMoveScrambleProvider().quality).toBe('random-move');
  });

  it('generates the requested number of moves', async () => {
    const provider = createRandomMoveScrambleProvider({ length: 25, random: seededRandom(1) });
    const scramble = await provider.generate();
    expect(scramble.moves).toHaveLength(25);
  });

  it('produces notation the engine can parse back', async () => {
    const provider = createRandomMoveScrambleProvider({ random: seededRandom(2) });
    const scramble = await provider.generate();
    expect(parseAlgorithm(scramble.notation)).toEqual(scramble.moves);
  });

  it('is deterministic for a given seed', async () => {
    const first = await createRandomMoveScrambleProvider({ random: seededRandom(7) }).generate();
    const second = await createRandomMoveScrambleProvider({ random: seededRandom(7) }).generate();
    expect(first.notation).toBe(second.notation);
  });

  it('scrambles the cube', async () => {
    const provider = createRandomMoveScrambleProvider({ random: seededRandom(3) });
    const scramble = await provider.generate();
    expect(isSolved(applyMoves(createSolvedCube(), scramble.moves))).toBe(false);
  });

  it('emits only legal moves', async () => {
    const provider = createRandomMoveScrambleProvider({ random: seededRandom(4) });
    const scramble = await provider.generate();
    expect(scramble.moves.every((move) => isMove(move))).toBe(true);
  });

  // The two redundancy rules, checked across many seeds rather than one, because a
  // single scramble might not happen to contain the pattern being guarded against.
  it('never repeats the same face consecutively', async () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const scramble = await createRandomMoveScrambleProvider({
        random: seededRandom(seed),
      }).generate();
      const faces = scramble.moves.map((move) => move[0] as Face);
      for (let i = 1; i < faces.length; i += 1) {
        expect(faces[i]).not.toBe(faces[i - 1]);
      }
    }
  });

  it('never puts three consecutive moves on the same axis', async () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const scramble = await createRandomMoveScrambleProvider({
        random: seededRandom(seed),
      }).generate();
      const axes = scramble.moves.map((move) => AXIS[move[0] as Face]);
      for (let i = 2; i < axes.length; i += 1) {
        expect(axes[i] === axes[i - 1] && axes[i - 1] === axes[i - 2]).toBe(false);
      }
    }
  });

  it('supports a zero-length scramble', async () => {
    const scramble = await createRandomMoveScrambleProvider({ length: 0 }).generate();
    expect(scramble.moves).toEqual([]);
    expect(scramble.notation).toBe('');
  });

  it('rejects a negative length', () => {
    expect(() => createRandomMoveScrambleProvider({ length: -1 })).toThrow(RangeError);
  });
});
