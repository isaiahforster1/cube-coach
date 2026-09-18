import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { createAuthRepository } from './modules/auth/auth.repository.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { registerAuthentication } from './plugins/authenticate.js';
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
  /**
   * Request ceilings, overridable so tests can raise them out of the way or lower them
   * to assert the limiter actually fires.
   *
   * Rate limiting keys on client IP, and every `inject()` call shares one — so without
   * an override the suite would exhaust the credential budget after ten logins and
   * every later test would fail confusingly.
   */
  readonly rateLimit?: {
    readonly max?: number;
    readonly credentialMax?: number;
  };
}

/**
 * Build the application.
 *
 * This is a factory rather than a module-level singleton, and that choice is what makes
 * the API testable. A test constructs its own instance with its own configuration and
 * its own database client, then sends requests through `app.inject()` — no port is
 * opened and no network is involved, but the full stack runs: routing, parsing,
 * validation, error handling.
 */
export async function buildApp({
  config,
  prisma,
  rateLimit: limits,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Development logs are for a human reading a terminal; production logs are JSON
      // for a log aggregator to index.
      ...(config.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : {}),
    },
    // Trust the load balancer's X-Forwarded-For only in production, where there is one.
    // Trusting it in development would let any client spoof its own IP — and rate
    // limiting keys on that IP.
    trustProxy: config.NODE_ENV === 'production',
  });

  app.decorate('prisma', prisma);
  app.decorate('config', config);

  await app.register(cookie);
  await app.register(rateLimit, {
    // A global ceiling. Individual routes tighten it where it matters.
    max: limits?.max ?? 300,
    timeWindow: '1 minute',
  });

  const authService = createAuthService(createAuthRepository(prisma));

  registerErrorHandler(app, config.NODE_ENV === 'production');
  registerAuthentication(app, authService);
  registerHealthRoutes(app);
  registerAuthRoutes(app, authService, limits?.credentialMax ?? 10);

  return app;
}
