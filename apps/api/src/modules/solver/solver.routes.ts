import type { FastifyInstance } from 'fastify';
import { formatAlgorithm, solverStepsQuerySchema } from '@cube-coach/shared';
import { solveSteps } from './solver.service.js';
import type { StepExplainer } from './step-explainer.js';

/**
 * The step solver, open to guests like every other feature (ADR-0012).
 *
 * GET, because solving a scramble changes nothing. That also makes a solution a link
 * someone can share. A model's wording can differ between calls, but the explainer's
 * cache gives the same step the same text while the process runs (ADR-0022 §5).
 *
 * Its rate limit is tighter than the global one. Every request is real CPU work on the
 * event loop, it needs no account, and with a model configured each request also spends
 * the model's daily quota. The explainer's own daily cap bounds that across all clients.
 */
export function registerSolverRoutes(
  app: FastifyInstance,
  max: number,
  explainer: StepExplainer,
): void {
  app.get(
    '/solver/steps',
    { config: { rateLimit: { max, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { scramble, crossFace } = solverStepsQuerySchema.parse(request.query);
      const result = await solveSteps(scramble, crossFace, explainer, request.log);

      // ADR-0021 §4: a failed slot search is logged so the scramble can become a fixture.
      if (result.status === 'failed') {
        request.log.warn({ scramble: formatAlgorithm(scramble), crossFace }, 'F2L search failed');
      }
      return reply.send(result);
    },
  );
}
