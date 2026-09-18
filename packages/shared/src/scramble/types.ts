import type { Move } from '../cube/types.js';

/**
 * How a scramble was produced. This is surfaced rather than hidden because the two
 * are not equivalent in quality, and a timer that silently downgrades would be
 * misleading to anyone practising seriously.
 *
 * - `random-state` generates a random cube position and solves it. Every position is
 *   equally likely, which is what competition rules require.
 * - `random-move` strings together random turns. Cheap and offline, but the resulting
 *   positions are not uniformly distributed, so it is a fallback, not a default.
 */
export type ScrambleQuality = 'random-state' | 'random-move';

export interface Scramble {
  /** The scramble as moves, already validated against the engine's notation. */
  readonly moves: readonly Move[];
  /** The same scramble as a display string, e.g. `"R U2 F' L D B2"`. */
  readonly notation: string;
  readonly quality: ScrambleQuality;
}

/**
 * A source of scrambles.
 *
 * Generation is asynchronous because producing a competition-quality scramble means
 * running a solver, which happens in a worker. Keeping the interface async means the
 * fast fallback and the real generator are interchangeable.
 */
export interface ScrambleProvider {
  readonly quality: ScrambleQuality;
  generate(): Promise<Scramble>;
}
