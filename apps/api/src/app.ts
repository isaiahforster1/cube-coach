import type { Writable } from 'node:stream';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { createAuthRepository } from './modules/auth/auth.repository.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { createEmailVerificationService } from './modules/auth/email-verification.js';
import { registerEmailVerificationRoutes } from './modules/auth/email-verification.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createGoogleOAuth, type GoogleOAuth } from './modules/auth/google.js';
import {
  createLogEmailSender,
  createResendEmailSender,
  type EmailSender,
} from './modules/email/email-sender.js';
import { registerAuthProviderRoutes, registerGoogleRoutes } from './modules/auth/google.routes.js';
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
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { registerWebClient } from './plugins/web-client.js';

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
    readonly solveMax?: number;
    readonly solveBatchMax?: number;
    readonly verificationMax?: number;
  };
  /**
   * Where the built web client lives, when this process is serving it too.
   *
   * Absent in development, where Vite serves the client on its own port, and in tests,
   * which have no build to serve.
   */
  readonly webRoot?: string;
  /**
   * Stand in for Google, so tests can drive the whole sign-in flow without credentials
   * or a network. When given, the Google routes are registered regardless of config.
   */
  readonly google?: GoogleOAuth;
  /** Stand in for the email provider, so tests can read what would have been sent. */
  readonly emailSender?: EmailSender;
  /** Where log lines go instead of stdout, so tests can assert on what is logged. */
  readonly logStream?: Writable;
}

/**
 * Trust exactly `hops` proxies in front of this process, and no more.
 *
 * A proxy that appends to X-Forwarded-For leaves whatever the client sent on the left and
 * adds the address it actually saw on the right. `trustProxy: true` trusts every entry and
 * takes the leftmost, which is the client's own claim — so a forged value per request was
 * a fresh rate-limit bucket per request. Trusting one hop takes the entry our proxy wrote.
 *
 * A function rather than the number itself, deliberately. Fastify 5 treats a numeric
 * `trustProxy` as "trust nothing", which would make every request appear to come from the
 * load balancer and put all users in a single rate-limit bucket.
 *
 * This relies on the process being reachable only through that proxy, which is how the
 * platform runs it. If another proxy is added in front, a CDN for example, `hops` has to go
 * up with it.
 */
function trustedProxyHops(hops: number) {
  return (_address: string, hop: number): boolean => hop < hops;
}

/**
 * What each request contributes to the log: Fastify's default fields, minus the query
 * string (and the source port, which behind a proxy is only the proxy's connection).
 *
 * Query strings can carry secrets. The Google callback's carries a live authorization
 * code, and logs are kept, shipped to aggregators and read by more people than the
 * database is. Paths are enough to debug with; nothing here needs the query to be logged.
 */
function serializeRequestForLog(request: FastifyRequest) {
  return {
    method: request.method,
    url: request.url.split('?')[0] ?? request.url,
    host: request.host,
    remoteAddress: request.ip,
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
  webRoot,
  google: googleOverride,
  emailSender: emailSenderOverride,
  logStream,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Development logs are for a human reading a terminal; production logs are JSON
      // for a log aggregator to index.
      ...(config.NODE_ENV === 'development' && logStream === undefined
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : {}),
      ...(logStream === undefined ? {} : { stream: logStream }),
      serializers: { req: serializeRequestForLog },
    },
    // Trust X-Forwarded-For only in production, where there is a load balancer, and only
    // as many hops as there are proxies. Rate limiting keys on the client IP this produces.
    trustProxy: config.NODE_ENV === 'production' ? trustedProxyHops(1) : false,
    // A solve payload is a few hundred bytes. Anything approaching this is a mistake
    // or an attempt, and rejecting it early costs nothing.
    bodyLimit: 64 * 1024,
  });

  const isProduction = config.NODE_ENV === 'production';

  await registerSecurityHeaders(app, { isProduction });

  app.decorate('prisma', prisma);
  app.decorate('config', config);

  // CORS only when a separate web origin is configured. With none, no CORS headers are
  // sent and the browser's same-origin policy refuses every cross-origin read — the
  // strongest setting, and all that production needs, since it serves one origin.
  //
  // When it is registered, `credentials` is what allows the session cookie to travel at
  // all; without it the browser silently drops the cookie on cross-origin requests.
  //
  // Methods are stated explicitly rather than left to defaults. PATCH and DELETE trigger
  // a preflight OPTIONS, and if the response does not name the method, the real request
  // is blocked — surfacing as a bare network error that explains nothing.
  if (config.WEB_ORIGIN !== undefined) {
    await app.register(cors, {
      origin: config.WEB_ORIGIN,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
    });
  }

  await app.register(cookie);
  await app.register(rateLimit, {
    // A global ceiling. Individual routes tighten it where it matters.
    max: limits?.max ?? 300,
    timeWindow: '1 minute',
  });

  const authRepository = createAuthRepository(prisma);
  const authService = createAuthService(authRepository);

  /**
   * Email verification needs somewhere to send mail and an address to link back to.
   *
   * Resend when it is configured; otherwise development logs the email, and production
   * sends none. Without verification every password stays unproved, which is safe: a
   * Google link then discards it, exactly as before verification existed (ADR-0019).
   */
  const emailSender =
    emailSenderOverride ??
    (config.RESEND_API_KEY !== undefined && config.EMAIL_FROM !== undefined
      ? createResendEmailSender({ apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM })
      : isProduction
        ? null
        : createLogEmailSender(app.log));

  const emailVerification =
    emailSender === null || config.APP_URL === undefined
      ? null
      : createEmailVerificationService(authRepository, emailSender, config.APP_URL);

  /**
   * Google sign-in is only wired up when it is configured.
   *
   * An option that appears and then fails when pressed is worse than one that is absent,
   * so the routes and the button both depend on the credentials existing.
   */
  const googleConfig =
    config.GOOGLE_CLIENT_ID !== undefined &&
    config.GOOGLE_CLIENT_SECRET !== undefined &&
    config.GOOGLE_REDIRECT_URI !== undefined
      ? {
          clientId: config.GOOGLE_CLIENT_ID,
          clientSecret: config.GOOGLE_CLIENT_SECRET,
          redirectUri: config.GOOGLE_REDIRECT_URI,
        }
      : null;

  const google = googleOverride ?? (googleConfig === null ? null : createGoogleOAuth(googleConfig));

  const practiceSessionsRepository = createPracticeSessionsRepository(prisma);
  const practiceSessionsService = createPracticeSessionsService(practiceSessionsRepository);
  const solvesRepository = createSolvesRepository(prisma);
  const statsService = createStatsService(solvesRepository);
  const solvesService = createSolvesService(solvesRepository, practiceSessionsRepository);

  // Registered before the error handler, which needs to know whether an unmatched page
  // request is a client route or a genuine 404.
  const servesWebClient = webRoot === undefined ? false : await registerWebClient(app, webRoot);

  registerErrorHandler(app, { isProduction, servesWebClient });
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
      registerAuthRoutes(instance, authService, emailVerification, limits?.credentialMax ?? 10);
      if (emailVerification !== null) {
        registerEmailVerificationRoutes(instance, emailVerification, {
          verificationMax: limits?.verificationMax ?? 10,
        });
      }
      registerAuthProviderRoutes(instance, google !== null);
      if (google !== null) registerGoogleRoutes(instance, authService, google);
      registerPracticeSessionRoutes(instance, practiceSessionsService);
      registerSolveRoutes(instance, solvesService, {
        solveMax: limits?.solveMax ?? 60,
        solveBatchMax: limits?.solveBatchMax ?? 10,
      });
      registerStatsRoutes(instance, statsService);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
