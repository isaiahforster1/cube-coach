import type { FastifyInstance } from 'fastify';
import {
  createSolveRequestSchema,
  listSolvesQuerySchema,
  updateSolveRequestSchema,
} from '@cube-coach/shared';
import { currentUser } from '../../plugins/authenticate.js';
import type { SolvesService } from './solves.service.js';

export function registerSolveRoutes(app: FastifyInstance, service: SolvesService): void {
  // Every route here needs a signed-in user; none of them are public.
  const auth = { preHandler: app.requireAuth };

  /**
   * Create a solve, idempotently.
   *
   * Returns 200 rather than 201 because the same request may legitimately arrive twice
   * after a retry, and the second one creates nothing. Insisting on 201 would mean
   * either lying or making the client handle two success codes for one outcome.
   */
  app.post('/solves', auth, async (request, reply) => {
    const input = createSolveRequestSchema.parse(request.body);
    const solve = await service.create(currentUser(request).id, input);
    return reply.send({ solve });
  });

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
