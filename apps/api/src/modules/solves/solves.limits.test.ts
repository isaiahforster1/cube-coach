import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../test/context.js';
import { SESSION_COOKIE } from '../auth/auth.cookie.js';

/**
 * Per-account limits on writing solves.
 *
 * Statistics are computed over everything stored, so the cost of reading them grows with
 * every solve written. A limit on writes is what keeps that growth at human speed. It is
 * keyed on the account rather than the IP, because an attacker controls how many IPs
 * they use but not how many accounts they are signed in as.
 */
const SOLVE_MAX = 3;
const BATCH_MAX = 2;

let context: TestContext;

beforeEach(async () => {
  context ??= await createTestContext({
    rateLimit: { solveMax: SOLVE_MAX, solveBatchMax: BATCH_MAX },
  });
  await context.reset();
});

afterAll(async () => {
  await context?.close();
});

async function signUp(email: string) {
  const registration = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'a-long-enough-password', displayName: 'Cuber' },
  });
  const cookie = registration.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';

  const sessions = await context.app.inject({
    method: 'GET',
    url: '/api/v1/practice-sessions',
    cookies: { [SESSION_COOKIE]: cookie },
  });

  return { cookie, practiceSessionId: sessions.json().practiceSessions[0].id as string };
}

function solvePayload(practiceSessionId: string) {
  return {
    id: randomUUID(),
    practiceSessionId,
    scramble: "R U R' U' F2 D",
    durationMs: 12_340,
    solvedAt: new Date().toISOString(),
  };
}

function post(cookie: string, url: string, payload: Record<string, unknown>) {
  return context.app.inject({
    method: 'POST',
    url,
    cookies: { [SESSION_COOKIE]: cookie },
    payload,
  });
}

describe('POST /solves limit', () => {
  it('fires once an account exceeds it', async () => {
    const cuber = await signUp('a@example.com');

    for (let attempt = 0; attempt < SOLVE_MAX; attempt += 1) {
      const response = await post(
        cuber.cookie,
        '/api/v1/solves',
        solvePayload(cuber.practiceSessionId),
      );
      expect(response.statusCode).toBe(200);
    }

    const response = await post(
      cuber.cookie,
      '/api/v1/solves',
      solvePayload(cuber.practiceSessionId),
    );
    expect(response.statusCode).toBe(429);
  });

  /** Keyed on the account: one busy account does not lock out another behind the same IP. */
  it('counts each account separately', async () => {
    const first = await signUp('a@example.com');
    const second = await signUp('b@example.com');

    for (let attempt = 0; attempt <= SOLVE_MAX; attempt += 1) {
      await post(first.cookie, '/api/v1/solves', solvePayload(first.practiceSessionId));
    }

    const response = await post(
      second.cookie,
      '/api/v1/solves',
      solvePayload(second.practiceSessionId),
    );
    expect(response.statusCode).toBe(200);
  });
});

describe('POST /solves/batch', () => {
  it('stores every solve in the batch', async () => {
    const cuber = await signUp('a@example.com');
    const solves = Array.from({ length: 5 }, () => solvePayload(cuber.practiceSessionId));

    const response = await post(cuber.cookie, '/api/v1/solves/batch', { solves });

    expect(response.statusCode).toBe(200);
    expect(response.json().solves).toHaveLength(5);
    expect(await context.prisma.solve.count()).toBe(5);
  });

  /** Guest migration may be interrupted and resumed, so a repeated batch must be harmless. */
  it('is idempotent, like a single create', async () => {
    const cuber = await signUp('a@example.com');
    const solves = Array.from({ length: 3 }, () => solvePayload(cuber.practiceSessionId));

    await post(cuber.cookie, '/api/v1/solves/batch', { solves });
    await post(cuber.cookie, '/api/v1/solves/batch', { solves });

    expect(await context.prisma.solve.count()).toBe(3);
  });

  it('refuses more than 100 solves in one request', async () => {
    const cuber = await signUp('a@example.com');
    const solves = Array.from({ length: 101 }, () => solvePayload(cuber.practiceSessionId));

    const response = await post(cuber.cookie, '/api/v1/solves/batch', { solves });

    expect(response.statusCode).toBe(400);
    expect(await context.prisma.solve.count()).toBe(0);
  });

  it('refuses a batch aimed at someone else’s practice session', async () => {
    const owner = await signUp('a@example.com');
    const intruder = await signUp('b@example.com');

    const response = await post(intruder.cookie, '/api/v1/solves/batch', {
      solves: [solvePayload(owner.practiceSessionId)],
    });

    expect(response.statusCode).toBe(404);
    expect(await context.prisma.solve.count()).toBe(0);
  });

  it('has its own per-account limit', async () => {
    const cuber = await signUp('a@example.com');

    for (let attempt = 0; attempt < BATCH_MAX; attempt += 1) {
      const response = await post(cuber.cookie, '/api/v1/solves/batch', {
        solves: [solvePayload(cuber.practiceSessionId)],
      });
      expect(response.statusCode).toBe(200);
    }

    const response = await post(cuber.cookie, '/api/v1/solves/batch', {
      solves: [solvePayload(cuber.practiceSessionId)],
    });
    expect(response.statusCode).toBe(429);
  });

  it('requires a signed-in user', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/solves/batch',
      payload: { solves: [] },
    });
    expect(response.statusCode).toBe(401);
  });
});
