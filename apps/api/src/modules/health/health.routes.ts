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
      /**
       * A real table, not `SELECT 1`.
       *
       * `SELECT 1` proves only that something answered on the other end of the socket.
       * A freshly provisioned database with no migrations applied satisfies it
       * perfectly, so the instance reported itself ready, the platform sent it traffic,
       * and every request that touched a table failed — which is the one situation a
       * readiness check exists to prevent.
       *
       * Reading a row instead proves the schema is actually there. `findFirst` with a
       * single selected column is a `LIMIT 1`, so it stays cheap however large the
       * table grows, and an empty table is a perfectly good answer: what is being
       * asked is whether the query can run at all, not whether anyone has signed up.
       */
      await app.prisma.user.findFirst({ select: { id: true } });
      return { status: 'ready', database: 'ok' };
    } catch (error) {
      app.log.error({ err: error }, 'Readiness check failed');
      return reply.status(503).send({
        error: { code: 'NOT_READY', message: 'Database is unreachable' },
      });
    }
  });
}
