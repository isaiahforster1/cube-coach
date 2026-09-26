import type { FastifyInstance } from 'fastify';
import { createPracticeSessionRequestSchema, idParamsSchema } from '@cube-coach/shared';
import { currentUser } from '../../plugins/authenticate.js';
import type { PracticeSessionsService } from './practice-sessions.service.js';

export function registerPracticeSessionRoutes(
  app: FastifyInstance,
  service: PracticeSessionsService,
): void {
  const auth = { preHandler: app.requireAuth };

  app.get('/practice-sessions', auth, async (request, reply) => {
    const sessions = await service.list(currentUser(request).id);
    return reply.send({ practiceSessions: sessions });
  });

  app.post('/practice-sessions', auth, async (request, reply) => {
    const input = createPracticeSessionRequestSchema.parse(request.body);
    const session = await service.create(currentUser(request).id, input);
    return reply.status(201).send({ practiceSession: session });
  });

  app.delete('/practice-sessions/:id', auth, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const session = await service.archive(currentUser(request).id, id);
    return reply.send({ practiceSession: session });
  });
}
