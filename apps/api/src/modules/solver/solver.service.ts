import {
  applyMoves,
  chooseExplanation,
  createSolvedCube,
  solveCross,
  solveF2L,
  STANDARD_COLOUR_NAMES,
  type ExplainableStep,
  type Face,
  type Move,
  type SolverStep,
  type SolverStepsResponse,
} from '@cube-coach/shared';

/**
 * One step as the person sees it.
 *
 * `undefined` is where a model's text will go (ADR-0021 §6). With nothing there,
 * `chooseExplanation` returns the template, which is the whole feature until a model is
 * configured. Why a model's text was refused is for the log, not the client, so only the
 * source and the text are kept.
 */
function present(kind: SolverStep['kind'], step: ExplainableStep): SolverStep {
  const { source, text } = chooseExplanation(step, undefined, STANDARD_COLOUR_NAMES);
  return { kind, tokens: step.tokens, explanation: { source, text } };
}

/**
 * The cross and F2L for a scramble, each step with its explanation.
 *
 * Synchronous and CPU-bound: about 4 ms at the median and under 40 ms at worst (ADR-0021,
 * step 4 timing), which blocks the event loop for that long. That is acceptable at this
 * size and is why the route has its own rate limit. The first request for each cross face
 * also builds that face's tables, about 100 ms, once per process.
 */
export function solveSteps(scramble: readonly Move[], crossFace: Face): SolverStepsResponse {
  const start = applyMoves(createSolvedCube(), scramble);
  const cross = solveCross(start, crossFace);
  const f2l = solveF2L(start, cross);

  return {
    crossFace,
    status: f2l.status,
    steps: [present('cross', cross), ...f2l.steps.map((step) => present('pair', step))],
  };
}
