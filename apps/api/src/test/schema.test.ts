import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './context.js';

/**
 * Exercises the migrated schema against a real database.
 *
 * This is the test that proves the harness works end to end: migrations applied,
 * relations wired, constraints enforced, and `reset()` genuinely clearing state
 * between tests. Every later milestone builds on it.
 */
let context: TestContext;

beforeEach(async () => {
  context ??= await createTestContext();
  await context.reset();
});

afterAll(async () => {
  await context?.close();
});

async function createUser(email = 'cuber@example.com') {
  return context.prisma.user.create({
    data: { email, passwordHash: 'not-a-real-hash', displayName: 'Test Cuber' },
  });
}

describe('schema', () => {
  it('stores and reads back a user', async () => {
    const created = await createUser();
    const found = await context.prisma.user.findUnique({ where: { id: created.id } });

    expect(found?.email).toBe('cuber@example.com');
    expect(found?.createdAt).toBeInstanceOf(Date);
  });

  it('enforces unique emails', async () => {
    await createUser();
    await expect(createUser()).rejects.toThrow();
  });

  it('starts every test with an empty database', async () => {
    // If reset() did not work, the user created by the previous test would still be
    // here and this count would not be zero.
    expect(await context.prisma.user.count()).toBe(0);
  });

  it('stores a solve against a practice session', async () => {
    const user = await createUser();
    const session = await context.prisma.practiceSession.create({
      data: { userId: user.id, name: 'Evening practice' },
    });

    const solve = await context.prisma.solve.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        practiceSessionId: session.id,
        scramble: "R U R' U' F2 D",
        durationMs: 14_320,
        solvedAt: new Date(),
      },
    });

    expect(solve.durationMs).toBe(14_320);
    expect(solve.penalty).toBe('NONE');
    expect(solve.deletedAt).toBeNull();
  });

  it('accepts a client-generated id, so a retry cannot duplicate a solve', async () => {
    const user = await createUser();
    const session = await context.prisma.practiceSession.create({
      data: { userId: user.id, name: 'Session' },
    });

    const id = randomUUID();
    const data = {
      id,
      userId: user.id,
      practiceSessionId: session.id,
      scramble: 'U2 F',
      durationMs: 9_000,
      solvedAt: new Date(),
    };

    await context.prisma.solve.create({ data });
    // A second create with the same id must fail rather than insert a duplicate. The
    // API turns this into an idempotent upsert in M7.
    await expect(context.prisma.solve.create({ data })).rejects.toThrow();
    expect(await context.prisma.solve.count()).toBe(1);
  });

  it('deletes a user cascade-deletes their solves and sessions', async () => {
    const user = await createUser();
    const session = await context.prisma.practiceSession.create({
      data: { userId: user.id, name: 'Session' },
    });
    await context.prisma.solve.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        practiceSessionId: session.id,
        scramble: 'F',
        durationMs: 1_000,
        solvedAt: new Date(),
      },
    });

    await context.prisma.user.delete({ where: { id: user.id } });

    expect(await context.prisma.solve.count()).toBe(0);
    expect(await context.prisma.practiceSession.count()).toBe(0);
  });

  it('rejects a solve pointing at a practice session that does not exist', async () => {
    const user = await createUser();

    await expect(
      context.prisma.solve.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          practiceSessionId: randomUUID(),
          scramble: 'F',
          durationMs: 1_000,
          solvedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });
});
