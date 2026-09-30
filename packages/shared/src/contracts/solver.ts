import { z } from 'zod';
import { InvalidNotationError, parseAlgorithm } from '../cube/notation.js';
import { FACES, type Face, type Token } from '../cube/types.js';
import type { ColourNames } from '../solver/explain.js';

/**
 * Request and response shapes for the step solver (ADR-0021).
 *
 * Shared by the API and the client, so the scramble rule is the same on both sides: the
 * client can reject a typo before sending it, and the server rejects it regardless.
 */

/**
 * The colour words explanations are written in: the standard Western scheme.
 *
 * The engine names faces, not colours (see `cube/types.ts`). This lives in the contract
 * rather than the engine because the server now writes sentences such as "the green–red
 * pair", and the web app colours its stickers from the same table, so the words and the
 * cube on screen cannot disagree. A per-user scheme would have to travel in the request.
 */
export const STANDARD_COLOUR_NAMES: ColourNames = {
  U: 'white',
  D: 'yellow',
  F: 'green',
  B: 'blue',
  R: 'red',
  L: 'orange',
};

/**
 * A scramble is face turns only. The solver's state must have every centre at home
 * (ADR-0021 §1), so a rotation or a wide turn is refused here rather than deep inside it.
 */
const scrambleSchema = z
  .string()
  .max(500)
  .transform((text, context) => {
    try {
      const moves = parseAlgorithm(text);
      if (moves.length === 0) {
        context.addIssue({ code: 'custom', message: 'Enter a scramble' });
        return z.NEVER;
      }
      return moves;
    } catch (error) {
      if (!(error instanceof InvalidNotationError)) throw error;
      context.addIssue({ code: 'custom', message: error.message });
      return z.NEVER;
    }
  });

export const solverStepsQuerySchema = z.object({
  scramble: scrambleSchema,
  crossFace: z.enum(FACES).default('D'),
});

export type SolverStepsQuery = z.infer<typeof solverStepsQuerySchema>;

export interface SolverStep {
  readonly kind: 'cross' | 'pair';
  /** Rotations and moves exactly as the person performs them, in the held frame. */
  readonly tokens: readonly Token[];
  /**
   * What the person reads. `template` until a model is configured, and afterwards
   * whenever the model's text fails the notation gate.
   */
  readonly explanation: { readonly source: 'model' | 'template'; readonly text: string };
}

export interface SolverStepsResponse {
  readonly crossFace: Face;
  /** `failed` keeps the steps that succeeded. No scramble in testing has reached it. */
  readonly status: 'solved' | 'failed';
  /** The cross, then one step per pair. A pair the cross or an earlier insert solved gets none. */
  readonly steps: readonly SolverStep[];
}
