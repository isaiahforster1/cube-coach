import Fastify, { type FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { registerErrorHandler } from './plugins/error-handler.js';

declare module 'fastify' {
  interface FastifyInstance {
    readonly prisma: PrismaClient;
    readonly config: Config;
  }
}

export interface BuildAppOptions {
  readonly config: Config;
  readonly prisma: PrismaClient;
}

/**
 * Build the application.
 *
 * This is a factory rather than a module-level singleton, and that choice is what
 * makes the API testable. A test constructs its own instance with its own
 * configuration and its own database client, then sends requests through
 * `app.inject()` — no port is opened, no network is involved, but the full stack
 * runs: routing, parsing, validation, error handling.
 *
 * A singleton would force tests to share one instance and to reach into global state
 * to substitute anything.
 */
export function buildApp({ config, prisma }: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Development logs are for a human reading a terminal; production logs are
      // JSON for a log aggregator to index.
      ...(config.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : {}),
    },
    // Trust the load balancer's X-Forwarded-For only in production, where there is
    // one. Trusting it in development would let any client spoof its own IP.
    trustProxy: config.NODE_ENV === 'production',
  });

  app.decorate('prisma', prisma);
  app.decorate('config', config);

  registerErrorHandler(app, config.NODE_ENV === 'production');
  registerHealthRoutes(app);

  return app;
}
