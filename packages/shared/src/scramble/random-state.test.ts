import { describe, expect, it } from 'vitest';
import { applyMoves, createSolvedCube, isSolved } from '../cube/cube.js';
import { parseAlgorithm } from '../cube/notation.js';
import { createRandomStateScrambleProvider } from './random-state.js';

/**
 * An integration test against the real cubing.js solver, not a mock.
 *
 * The thing worth verifying is the seam between their notation and ours: a mock would
 * only prove that our own assumptions are self-consistent. Running the real generator
 * is what catches the library emitting a move this engine cannot parse.
 *
 * It loads a WebAssembly solver, so the first call is slower than a normal unit test.
 */
describe('createRandomStateScrambleProvider', () => {
  it('reports its quality honestly', () => {
    expect(createRandomStateScrambleProvider().quality).toBe('random-state');
  });

  it('produces a scramble the engine understands', { timeout: 60_000 }, async () => {
    const scramble = await createRandomStateScrambleProvider().generate();

    expect(scramble.moves.length).toBeGreaterThan(0);
    expect(parseAlgorithm(scramble.notation)).toEqual(scramble.moves);
    expect(scramble.quality).toBe('random-state');
  });

  it('actually scrambles the cube', { timeout: 60_000 }, async () => {
    const scramble = await createRandomStateScrambleProvider().generate();
    expect(isSolved(applyMoves(createSolvedCube(), scramble.moves))).toBe(false);
  });

  it('does not repeat itself', { timeout: 60_000 }, async () => {
    const provider = createRandomStateScrambleProvider();
    const [first, second] = await Promise.all([provider.generate(), provider.generate()]);
    expect(first.notation).not.toBe(second.notation);
  });
});
