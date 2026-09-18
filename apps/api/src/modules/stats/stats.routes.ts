import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../../plugins/authenticate.js';
import type { StatsService } from './stats.service.js';

const querySchema = z.object({
  practiceSessionId: z.uuid().optional(),
});

export function registerStatsRoutes(app: FastifyInstance, service: StatsService): void {
  app.get('/stats/summary', { preHandler: app.requireAuth }, async (request, reply) => {
    const { practiceSessionId } = querySchema.parse(request.query);
    const summary = await service.summary(currentUser(request).id, practiceSessionId);
    return reply.send({ summary });
  });
}
