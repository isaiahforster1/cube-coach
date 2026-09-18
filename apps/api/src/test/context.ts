import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createPrismaClient } from '../db.js';

export interface TestContext {
  readonly app: FastifyInstance;
  readonly prisma: PrismaClient;
  /** Empty every table, so each test starts from a known state. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateTestContextOptions {
  /** Lower these to assert that the rate limiter actually fires. */
  readonly rateLimit?: { readonly max?: number; readonly credentialMax?: number };
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
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    // Tests should not print application logs unless something is being debugged.
    LOG_LEVEL: process.env['TEST_LOG_LEVEL'] ?? 'silent',
  });

  const prisma = createPrismaClient(config.DATABASE_URL);
  const app = await buildApp({
    config,
    prisma,
    // Raised well out of the way by default: every inject() shares one client IP, so
    // production limits would exhaust after ten logins and fail every later test.
    rateLimit: {
      max: options.rateLimit?.max ?? 100_000,
      credentialMax: options.rateLimit?.credentialMax ?? 100_000,
    },
  });
  await app.ready();

  return {
    app,
    prisma,

    async reset(): Promise<void> {
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
