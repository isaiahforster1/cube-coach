import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { createAuthRepository } from './modules/auth/auth.repository.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createPracticeSessionsRepository } from './modules/practice-sessions/practice-sessions.repository.js';
import { registerPracticeSessionRoutes } from './modules/practice-sessions/practice-sessions.routes.js';
import { createPracticeSessionsService } from './modules/practice-sessions/practice-sessions.service.js';
import { createSolvesRepository } from './modules/solves/solves.repository.js';
import { registerSolveRoutes } from './modules/solves/solves.routes.js';
import { createSolvesService } from './modules/solves/solves.service.js';
import { registerStatsRoutes } from './modules/stats/stats.routes.js';
import { createStatsService } from './modules/stats/stats.service.js';
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

  // The browser must be told our origin trusts the web client, and `credentials` is
  // what allows the session cookie to travel at all. Without it the browser silently
  // drops the cookie on cross-origin requests and every call looks unauthenticated.
  //
  // Methods are stated explicitly rather than left to defaults. PATCH and DELETE trigger
  // a preflight OPTIONS, and if the response does not name the method, the real request
  // is blocked — surfacing as a bare network error that explains nothing.
  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    // A global ceiling. Individual routes tighten it where it matters.
    max: limits?.max ?? 300,
    timeWindow: '1 minute',
  });

  const authService = createAuthService(createAuthRepository(prisma));

  const practiceSessionsRepository = createPracticeSessionsRepository(prisma);
  const practiceSessionsService = createPracticeSessionsService(practiceSessionsRepository);
  const solvesRepository = createSolvesRepository(prisma);
  const statsService = createStatsService(solvesRepository);
  const solvesService = createSolvesService(solvesRepository, practiceSessionsRepository);

  registerErrorHandler(app, config.NODE_ENV === 'production');
  registerAuthentication(app, authService);
  registerHealthRoutes(app);
  // Everything except the health probes lives under a version prefix. Versioning
  // from the start means a future breaking change can ship as /api/v2 alongside
  // v1, instead of forcing every client to update on the same day.
  //
  // Health checks stay at the root, unversioned, because they are infrastructure
  // rather than API: a platform probing /health should not care what version the
  // application is on.
  await app.register(
    async (instance) => {
      registerAuthRoutes(instance, authService, limits?.credentialMax ?? 10);
      registerPracticeSessionRoutes(instance, practiceSessionsService);
      registerSolveRoutes(instance, solvesService);
      registerStatsRoutes(instance, statsService);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
