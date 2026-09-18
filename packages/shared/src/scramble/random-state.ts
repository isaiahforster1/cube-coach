import { formatAlgorithm, parseAlgorithm } from '../cube/notation.js';
import type { Scramble, ScrambleProvider } from './types.js';

/**
 * Competition-quality scrambles, delegated to cubing.js.
 *
 * A proper scramble is produced by generating a uniformly random cube position and
 * then solving it, so every position is equally likely. Doing that requires a
 * two-phase solver, which is weeks of work and a solved problem elsewhere — so we use
 * the community-standard implementation rather than writing our own.
 *
 * The library is loaded with a dynamic import so that it is only fetched when a
 * scramble is actually requested. It carries a WebAssembly solver, and keeping it out
 * of the initial bundle matters for how quickly the timer becomes usable.
 */
export function createRandomStateScrambleProvider(): ScrambleProvider {
  return {
    quality: 'random-state',

    async generate(): Promise<Scramble> {
      const { randomScrambleForEvent } = await import('cubing/scramble');
      const algorithm = await randomScrambleForEvent('333');

      // Parse the library's output through our own notation rather than trusting it.
      // If cubing.js ever emits something this engine does not understand — a wide
      // turn, a rotation — this throws immediately instead of quietly producing a
      // cube state that does not match the scramble the user was shown.
      const moves = parseAlgorithm(algorithm.toString());

      return {
        moves,
        notation: formatAlgorithm(moves),
        quality: 'random-state',
      };
    },
  };
}
