import type { FastifyInstance } from 'fastify';
import { formatAlgorithm, solverStepsQuerySchema } from '@cube-coach/shared';
import { solveSteps } from './solver.service.js';

/**
 * The step solver, open to guests like every other feature (ADR-0012).
 *
 * GET, because solving a scramble changes nothing and the same question always gets the
 * same answer. That also makes a solution a link someone can share.
 *
 * Its rate limit is tighter than the global one. Every request is real CPU work on the
 * event loop, it needs no account, and once a model writes the text each request will
 * cost money too.
 */
export function registerSolverRoutes(app: FastifyInstance, max: number): void {
  app.get(
    '/solver/steps',
    { config: { rateLimit: { max, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { scramble, crossFace } = solverStepsQuerySchema.parse(request.query);
      const result = solveSteps(scramble, crossFace);

      // ADR-0021 §4: a failed slot search is logged so the scramble can become a fixture.
      if (result.status === 'failed') {
        request.log.warn({ scramble: formatAlgorithm(scramble), crossFace }, 'F2L search failed');
      }
      return reply.send(result);
    },
  );
}
