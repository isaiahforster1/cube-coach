import {
  applyMoves,
  createSolvedCube,
  solveCross,
  solveF2L,
  type Face,
  type Move,
  type SolverStepsResponse,
} from '@cube-coach/shared';
import type { ExplainerLog, StepExplainer, StepToExplain } from './step-explainer.js';

/**
 * The cross and F2L for a scramble, each step with its explanation.
 *
 * The solve itself is synchronous and CPU-bound: about 4 ms at the median and under 40 ms
 * at worst (ADR-0021, step 4 timing), which blocks the event loop for that long. That is
 * acceptable at this size and is why the route has its own rate limit. The first request
 * for each cross face also builds that face's tables, about 100 ms, once per process.
 *
 * The explanations are not. With a model configured, every step is explained at once, in
 * parallel, each within its own deadline (ADR-0022 §6). Why a model's text was refused is
 * for the log, not the client, so only the source and the text are kept.
 */
export async function solveSteps(
  scramble: readonly Move[],
  crossFace: Face,
  explainer: StepExplainer,
  log: ExplainerLog,
): Promise<SolverStepsResponse> {
  const start = applyMoves(createSolvedCube(), scramble);
  const cross = solveCross(start, crossFace);
  const f2l = solveF2L(start, cross);

  const steps: StepToExplain[] = [
    { kind: 'cross', tokens: cross.tokens, facts: cross.facts },
    ...f2l.steps.map((step): StepToExplain => ({
      kind: 'pair',
      tokens: step.tokens,
      facts: step.facts,
    })),
  ];

  return {
    crossFace,
    status: f2l.status,
    steps: await Promise.all(
      steps.map(async (step, index) => {
        const { source, text } = await explainer.explain(step, { index, log });
        return { kind: step.kind, tokens: step.tokens, explanation: { source, text } };
      }),
    ),
  };
}
