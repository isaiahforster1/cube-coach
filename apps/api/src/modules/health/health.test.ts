import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createPrismaClient } from '../../db.js';
import { createTestContext, type TestContext } from '../../test/context.js';

let context: TestContext;

beforeEach(async () => {
  context ??= await createTestContext();
  await context.reset();
});

afterAll(async () => {
  await context?.close();
});

describe('GET /health', () => {
  it('reports the process is alive without touching the database', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /health/ready', () => {
  it('reports ready when the database answers', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready', database: 'ok' });
  });
});

/**
 * The bug this exists for: readiness answered `SELECT 1`, which any Postgres connection
 * can satisfy whether or not a single table has been created. A freshly provisioned
 * database with no migrations applied reported itself ready, the platform sent it
 * traffic, and every request that touched a table failed.
 *
 * Proven against a real, genuinely empty schema rather than a mocked client, because
 * what is being asserted is exactly the difference between "Postgres answers" and "our
 * tables are there".
 */
describe('GET /health/ready against an unmigrated database', () => {
  const SCHEMA = 'readiness_check_unmigrated';

  let unmigrated: { app: FastifyInstance; prisma: PrismaClient } | undefined;

  beforeAll(async () => {
    const databaseUrl = process.env['TEST_DATABASE_URL'];
    if (databaseUrl === undefined || databaseUrl === '') {
      throw new Error('TEST_DATABASE_URL is not set');
    }

    // An empty schema in the same database: connectable, migrated to nothing.
    const setup = createPrismaClient(databaseUrl);
    await setup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await setup.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);
    await setup.$disconnect();

    /**
     * The adapter's own `schema` option, rather than anything in the URL.
     *
     * Two things that look like they should work do not. `?schema=` is a Prisma engine
     * parameter and Prisma 7 talks to Postgres through the `pg` driver, which simply
     * ignores it. `?options=-c search_path=` genuinely does change the session's
     * `search_path` — and changes nothing here, because Prisma writes fully qualified
     * SQL: `SELECT "public"."users"."id" FROM "public"."users"`. Both leave the client
     * reading the migrated tables, so the test would pass no matter what the route did.
     *
     * Telling the adapter the schema is what actually qualifies the generated SQL.
     */
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }, { schema: SCHEMA }),
    });

    const app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        LOG_LEVEL: 'silent',
      }),
      prisma,
    });
    await app.ready();
    unmigrated = { app, prisma };
  });

  afterAll(async () => {
    await unmigrated?.app.close();
    await unmigrated?.prisma.$disconnect();

    const databaseUrl = process.env['TEST_DATABASE_URL'] ?? '';
    if (databaseUrl !== '') {
      const teardown = createPrismaClient(databaseUrl);
      await teardown.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await teardown.$disconnect();
    }
  });

  it('is not ready when the tables do not exist', async () => {
    const response = await unmigrated!.app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('NOT_READY');
  });

  /** Liveness must still pass: the process is fine, its database is not. */
  it('still reports the process alive', async () => {
    const response = await unmigrated!.app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
  });
});
