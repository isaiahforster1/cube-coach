import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../test/context.js';
import { SESSION_COOKIE } from '../auth/auth.cookie.js';

let context: TestContext;
let cookie: string;
let practiceSessionId: string;

beforeEach(async () => {
  context ??= await createTestContext();
  await context.reset();

  const registration = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: 'cuber@example.com', password: 'a-long-enough-password', displayName: 'C' },
  });
  cookie = registration.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';

  const sessions = await context.app.inject({
    method: 'GET',
    url: '/api/v1/practice-sessions',
    cookies: { [SESSION_COOKIE]: cookie },
  });
  practiceSessionId = sessions.json().practiceSessions[0].id;
});

afterAll(async () => {
  await context?.close();
});

async function record(seconds: number[], penalty: 'none' | 'plus2' | 'dnf' = 'none') {
  const base = Date.parse('2026-09-18T12:00:00.000Z');
  for (const [index, value] of seconds.entries()) {
    await context.app.inject({
      method: 'POST',
      url: '/api/v1/solves',
      cookies: { [SESSION_COOKIE]: cookie },
      payload: {
        id: randomUUID(),
        practiceSessionId,
        scramble: 'U2 F2 U',
        durationMs: Math.round(value * 1000),
        penalty,
        solvedAt: new Date(base + index * 1000).toISOString(),
      },
    });
  }
}

function summary() {
  return context.app.inject({
    method: 'GET',
    url: '/api/v1/stats/summary',
    cookies: { [SESSION_COOKIE]: cookie },
  });
}

describe('GET /stats/summary', () => {
  it('requires a signed-in user', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/v1/stats/summary' });
    expect(response.statusCode).toBe(401);
  });

  it('returns empty statistics rather than an error for a new account', async () => {
    const response = await summary();

    expect(response.statusCode).toBe(200);
    expect(response.json().summary.bestSingleMs).toBeNull();
    expect(response.json().summary.averages.ao5.current).toEqual({
      kind: 'not-enough-solves',
      needed: 5,
    });
  });

  it('computes averages over the stored solves', async () => {
    await record([10, 11, 12, 13, 14]);

    const { summary: stats } = (await summary()).json();

    expect(stats.bestSingleMs).toBe(10_000);
    expect(stats.averages.ao5.current).toEqual({ kind: 'average', milliseconds: 12_000 });
    expect(stats.consistency.solveCount).toBe(5);
  });

  /** The rules from the shared package must survive the round trip through the database. */
  it('applies the DNF rules end to end', async () => {
    await record([10, 11, 12, 13]);
    await record([99], 'dnf');

    const { summary: stats } = (await summary()).json();

    // One DNF is trimmed as the worst solve, so the average still counts.
    expect(stats.averages.ao5.current).toEqual({ kind: 'average', milliseconds: 12_000 });
    expect(stats.consistency.dnfCount).toBe(1);
    // And its recorded duration never leaks into the best single.
    expect(stats.bestSingleMs).toBe(10_000);
  });

  it('reports consistency, not just an average', async () => {
    await record([10, 20, 30]);

    const { summary: stats } = (await summary()).json();

    expect(stats.consistency.meanMs).toBe(20_000);
    expect(stats.consistency.spreadMs).toBe(20_000);
    expect(stats.consistency.standardDeviationMs).toBe(8_165);
  });

  it('excludes deleted solves', async () => {
    await record([10, 11, 12]);

    const list = await context.app.inject({
      method: 'GET',
      url: '/api/v1/solves',
      cookies: { [SESSION_COOKIE]: cookie },
    });
    await context.app.inject({
      method: 'DELETE',
      url: `/api/v1/solves/${list.json().solves[0].id}`,
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect((await summary()).json().summary.consistency.solveCount).toBe(2);
  });

  it('never mixes in another user’s solves', async () => {
    await record([10, 11, 12]);

    const other = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'other@example.com', password: 'another-long-password', displayName: 'O' },
    });
    const otherCookie = other.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/stats/summary',
      cookies: { [SESSION_COOKIE]: otherCookie },
    });

    expect(response.json().summary.consistency.solveCount).toBe(0);
  });
});
