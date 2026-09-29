import type { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createPrismaClient } from '../db.js';
import type { GoogleOAuth } from '../modules/auth/google.js';
import { createFakeEmailSender, type FakeEmailSender } from './fake-email-sender.js';

export interface TestContext {
  readonly app: FastifyInstance;
  /** Every email the application sent, recorded instead of delivered. */
  readonly emails: FakeEmailSender;
  readonly prisma: PrismaClient;
  /** Empty every table, so each test starts from a known state. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateTestContextOptions {
  /** Lower these to assert that the rate limiter actually fires. */
  readonly rateLimit?: {
    readonly max?: number;
    readonly credentialMax?: number;
    readonly solveMax?: number;
    readonly solveBatchMax?: number;
    readonly verificationMax?: number;
  };
  /** A directory of built client files, for the tests that cover serving them. */
  readonly webRoot?: string;
  /** Run as production would, for the headers that only appear there. */
  readonly production?: boolean;
  /** A fake Google, which also switches the Google routes on. */
  readonly google?: GoogleOAuth;
  /** Replaces the fake that records email, e.g. to make sending fail. */
  readonly emailSender?: FakeEmailSender;
  /** Capture the application's logs, at info level, for tests about what gets logged. */
  readonly logStream?: Writable;
  /** Environment overrides; `undefined` removes a variable the local .env would set. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Build an application wired to the test database.
 *
 * Requests go through `app.inject()`, which runs the entire Fastify stack — routing,
 * body parsing, validation, error handling — without opening a port. That makes these
 * tests as fast as unit tests while still being genuinely end to end.
 */
export async function createTestContext(
  options: CreateTestContextOptions = {},
): Promise<TestContext> {
  const databaseUrl = process.env['TEST_DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('TEST_DATABASE_URL is not set');
  }

  const config = loadConfig({
    ...process.env,
    ...options.env,
    NODE_ENV: options.production === true ? 'production' : 'test',
    DATABASE_URL: databaseUrl,
    // Tests should not print application logs unless something is being debugged.
    LOG_LEVEL:
      options.logStream === undefined ? (process.env['TEST_LOG_LEVEL'] ?? 'silent') : 'info',
  });

  const emails = options.emailSender ?? createFakeEmailSender();
  const prisma = createPrismaClient(config.DATABASE_URL);
  const app = await buildApp({
    config,
    prisma,
    // Raised well out of the way by default: every inject() shares one client IP, so
    // production limits would exhaust after ten logins and fail every later test.
    rateLimit: {
      max: options.rateLimit?.max ?? 100_000,
      credentialMax: options.rateLimit?.credentialMax ?? 100_000,
      solveMax: options.rateLimit?.solveMax ?? 100_000,
      solveBatchMax: options.rateLimit?.solveBatchMax ?? 100_000,
      verificationMax: options.rateLimit?.verificationMax ?? 100_000,
    },
    ...(options.webRoot === undefined ? {} : { webRoot: options.webRoot }),
    ...(options.google === undefined ? {} : { google: options.google }),
    // Always a fake: no test sends real mail, whatever the local .env configures.
    emailSender: emails,
    ...(options.logStream === undefined ? {} : { logStream: options.logStream }),
  });
  await app.ready();

  return {
    emails,
    app,
    prisma,

    async reset(): Promise<void> {
      emails.sent.length = 0;

      // Discovered rather than hard-coded, so a new table cannot be forgotten here and
      // silently leak rows between tests. The migrations table is left alone.
      const tables = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      `;

      if (tables.length === 0) return;

      const quoted = tables.map((row) => `"public"."${row.tablename}"`).join(', ');
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
    },

    async close(): Promise<void> {
      await app.close();
      await prisma.$disconnect();
    },
  };
}
