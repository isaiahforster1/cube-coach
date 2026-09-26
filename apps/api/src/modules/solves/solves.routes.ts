import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  createSolveRequestSchema,
  createSolvesBatchRequestSchema,
  listSolvesQuerySchema,
  updateSolveRequestSchema,
} from '@cube-coach/shared';
import { currentUser } from '../../plugins/authenticate.js';
import type { SolvesService } from './solves.service.js';

export interface SolveWriteLimits {
  /** Single solves per account per minute. */
  readonly solveMax: number;
  /** Batches per account per minute. */
  readonly solveBatchMax: number;
}

/**
 * A per-account write limit.
 *
 * Statistics are computed over everything a user has stored, so each solve written makes
 * every later read a little more expensive. Limiting writes keeps that growth at the pace
 * of a person rather than a script.
 *
 * Keyed on the account, not the IP: an attacker can use as many addresses as they like,
 * but every request here has to be signed in as someone. That needs the user to be known,
 * so the check runs as a preHandler, after `requireAuth`, rather than on request arrival.
 * The per-IP global limit still applies on top.
 */
function perAccountLimit(name: string, max: number) {
  return {
    rateLimit: {
      max,
      timeWindow: '1 minute',
      hook: 'preHandler' as const,
      keyGenerator: (request: FastifyRequest) => `${name}:${currentUser(request).id}`,
    },
  };
}

export function registerSolveRoutes(
  app: FastifyInstance,
  service: SolvesService,
  limits: SolveWriteLimits,
): void {
  // Every route here needs a signed-in user; none of them are public.
  const auth = { preHandler: app.requireAuth };

  /**
   * Create a solve, idempotently.
   *
   * Returns 200 rather than 201 because the same request may legitimately arrive twice
   * after a retry, and the second one creates nothing. Insisting on 201 would mean
   * either lying or making the client handle two success codes for one outcome.
   */
  app.post(
    '/solves',
    // Generous for a human: the world record is about three seconds, and a real session
    // also spends time scrambling, so even a very fast cuber stays well under this.
    { ...auth, config: perAccountLimit('solves', limits.solveMax) },
    async (request, reply) => {
      const input = createSolveRequestSchema.parse(request.body);
      const solve = await service.create(currentUser(request).id, input);
      return reply.send({ solve });
    },
  );

  /**
   * Create up to a hundred solves at once, for moving a guest's history onto an account.
   *
   * Idempotent in the same way as a single create, so an interrupted upload can simply be
   * sent again. The body limit is raised for this route alone: a hundred solves with
   * maximum-length scrambles and comments come to about 125KB.
   */
  app.post(
    '/solves/batch',
    {
      ...auth,
      bodyLimit: 256 * 1024,
      config: perAccountLimit('solves-batch', limits.solveBatchMax),
    },
    async (request, reply) => {
      const { solves } = createSolvesBatchRequestSchema.parse(request.body);
      const created = await service.createMany(currentUser(request).id, solves);
      return reply.send({ solves: created });
    },
  );

  app.get('/solves', auth, async (request, reply) => {
    const query = listSolvesQuerySchema.parse(request.query);
    const page = await service.list(currentUser(request).id, query);
    return reply.send(page);
  });

  app.patch<{ Params: { id: string } }>('/solves/:id', auth, async (request, reply) => {
    const input = updateSolveRequestSchema.parse(request.body);
    const solve = await service.update(currentUser(request).id, request.params.id, input);
    return reply.send({ solve });
  });

  app.post<{ Params: { id: string } }>('/solves/:id/restore', auth, async (request, reply) => {
    const solve = await service.restore(currentUser(request).id, request.params.id);
    return reply.send({ solve });
  });

  app.delete<{ Params: { id: string } }>('/solves/:id', auth, async (request, reply) => {
    await service.remove(currentUser(request).id, request.params.id);
    return reply.status(204).send();
  });
}
