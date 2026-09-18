import type { FastifyInstance } from 'fastify';

/**
 * Two different questions, which deployment platforms treat differently.
 *
 * `/health` (liveness): is the process running? It touches nothing external. If this
 * fails, the process is wedged and should be restarted.
 *
 * `/health/ready` (readiness): can it actually serve traffic? It checks the database.
 * If this fails, the process is fine but its dependencies are not — restarting would
 * not help, so traffic should be routed elsewhere until it recovers.
 *
 * Conflating the two causes a classic outage: a brief database blip fails the health
 * check, the platform restarts every instance, and the restarts make things worse.
 */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', () => ({ status: 'ok' }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'ok' };
    } catch (error) {
      app.log.error({ err: error }, 'Readiness check failed');
      return reply.status(503).send({
        error: { code: 'NOT_READY', message: 'Database is unreachable' },
      });
    }
  });
}
