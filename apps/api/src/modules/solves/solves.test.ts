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
    payload: {
      email: 'cuber@example.com',
      password: 'a-long-enough-password',
      displayName: 'Cuber',
    },
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

function solvePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    practiceSessionId,
    scramble: "R U R' U' F2 D",
    durationMs: 12_340,
    solvedAt: new Date().toISOString(),
    ...overrides,
  };
}

function postSolve(payload: Record<string, unknown>) {
  return context.app.inject({
    method: 'POST',
    url: '/api/v1/solves',
    cookies: { [SESSION_COOKIE]: cookie },
    payload,
  });
}

describe('practice sessions', () => {
  // Without one, the timer would have nowhere to save on the very first solve.
  it('gives every new account a default session', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/practice-sessions',
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().practiceSessions).toHaveLength(1);
    expect(response.json().practiceSessions[0].name).toBe('Main session');
  });

  it('creates a named session', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/practice-sessions',
      cookies: { [SESSION_COOKIE]: cookie },
      payload: { name: 'One-handed' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().practiceSession.name).toBe('One-handed');
  });

  it('requires a signed-in user', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/v1/practice-sessions' });
    expect(response.statusCode).toBe(401);
  });
});

describe('POST /solves', () => {
  it('stores a solve', async () => {
    const response = await postSolve(solvePayload());

    expect(response.statusCode).toBe(200);
    expect(response.json().solve).toMatchObject({ durationMs: 12_340, penalty: 'none' });
    expect(await context.prisma.solve.count()).toBe(1);
  });

  /**
   * The behaviour the client-generated id exists for. If the network drops after the
   * server commits but before the response arrives, the client retries with the same id
   * — and must not end up with two copies of one solve.
   */
  it('is idempotent: the same id twice creates one solve', async () => {
    const payload = solvePayload();

    const first = await postSolve(payload);
    const second = await postSolve(payload);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().solve.id).toBe(first.json().solve.id);
    expect(await context.prisma.solve.count()).toBe(1);
  });

  it('does not let a retry overwrite the original measurement', async () => {
    const payload = solvePayload({ durationMs: 12_340 });
    await postSolve(payload);

    // A corrupted or malicious retry claiming a different time must not change what was
    // recorded. Penalties are corrected through PATCH, deliberately; the measurement is
    // immutable.
    const retry = await postSolve({ ...payload, durationMs: 1_000 });

    expect(retry.json().solve.durationMs).toBe(12_340);
  });

  it('records a penalty taken during inspection', async () => {
    const response = await postSolve(solvePayload({ penalty: 'plus2' }));
    expect(response.json().solve.penalty).toBe('plus2');
  });

  it('rejects a non-integer duration', async () => {
    const response = await postSolve(solvePayload({ durationMs: 12.5 }));
    expect(response.statusCode).toBe(400);
  });

  it('rejects a negative duration', async () => {
    const response = await postSolve(solvePayload({ durationMs: -1 }));
    expect(response.statusCode).toBe(400);
  });

  it('requires a signed-in user', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/solves',
      payload: solvePayload(),
    });

    expect(response.statusCode).toBe(401);
  });
});

/** Register a second account and return its cookie and default practice session. */
async function registerOtherUser() {
  const registration = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: 'someone-else@example.com',
      password: 'another-long-password',
      displayName: 'Someone Else',
    },
  });

  const otherCookie = registration.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';

  const sessions = await context.app.inject({
    method: 'GET',
    url: '/api/v1/practice-sessions',
    cookies: { [SESSION_COOKIE]: otherCookie },
  });

  return { cookie: otherCookie, practiceSessionId: sessions.json().practiceSessions[0].id };
}

/**
 * Authentication proves who you are. It is not permission to touch a particular row.
 *
 * Confusing the two is among the most common serious bugs in a web application, and it
 * is invisible in manual testing because you are only ever signed in as yourself.
 */
describe('one user cannot reach another user’s data', () => {
  it('rejects posting a solve into someone else’s practice session', async () => {
    const other = await registerOtherUser();

    const response = await postSolve(solvePayload({ practiceSessionId: other.practiceSessionId }));

    // 404, not 403: saying "forbidden" would confirm the id exists and belongs to
    // someone, which is itself a small leak.
    expect(response.statusCode).toBe(404);
    expect(await context.prisma.solve.count()).toBe(0);
  });

  it('never lists another user’s solves', async () => {
    await postSolve(solvePayload());
    const other = await registerOtherUser();

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/solves',
      cookies: { [SESSION_COOKIE]: other.cookie },
    });

    expect(response.json().solves).toHaveLength(0);
  });

  it('rejects editing another user’s solve', async () => {
    const created = await postSolve(solvePayload());
    const other = await registerOtherUser();

    const response = await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/solves/${created.json().solve.id}`,
      cookies: { [SESSION_COOKIE]: other.cookie },
      payload: { penalty: 'dnf' },
    });

    expect(response.statusCode).toBe(404);
    const untouched = await context.prisma.solve.findFirstOrThrow();
    expect(untouched.penalty).toBe('NONE');
  });

  it('rejects deleting another user’s solve', async () => {
    const created = await postSolve(solvePayload());
    const other = await registerOtherUser();

    const response = await context.app.inject({
      method: 'DELETE',
      url: `/api/v1/solves/${created.json().solve.id}`,
      cookies: { [SESSION_COOKIE]: other.cookie },
    });

    expect(response.statusCode).toBe(404);
    const untouched = await context.prisma.solve.findFirstOrThrow();
    expect(untouched.deletedAt).toBeNull();
  });
});

describe('PATCH /solves/:id', () => {
  it('applies a penalty after the fact', async () => {
    const created = await postSolve(solvePayload());

    const response = await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/solves/${created.json().solve.id}`,
      cookies: { [SESSION_COOKIE]: cookie },
      payload: { penalty: 'plus2' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().solve.penalty).toBe('plus2');
    // The raw measurement is untouched — the +2 is applied when reading, never stored
    // into the number, so toggling it repeatedly cannot drift the recorded time.
    expect(response.json().solve.durationMs).toBe(12_340);
  });

  it('can take a penalty back off', async () => {
    const created = await postSolve(solvePayload({ penalty: 'dnf' }));
    const id = created.json().solve.id;

    const response = await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/solves/${id}`,
      cookies: { [SESSION_COOKIE]: cookie },
      payload: { penalty: 'none' },
    });

    expect(response.json().solve.penalty).toBe('none');
    expect(response.json().solve.durationMs).toBe(12_340);
  });

  it('rejects an empty update', async () => {
    const created = await postSolve(solvePayload());

    const response = await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/solves/${created.json().solve.id}`,
      cookies: { [SESSION_COOKIE]: cookie },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('cannot be used to rewrite the measured time', async () => {
    const created = await postSolve(solvePayload());

    const response = await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/solves/${created.json().solve.id}`,
      cookies: { [SESSION_COOKIE]: cookie },
      payload: { durationMs: 1 },
    });

    // durationMs is not in the update schema, so Zod strips it and nothing is left.
    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /solves/:id', () => {
  it('hides the solve but keeps the row, so a mis-tap can be undone', async () => {
    const created = await postSolve(solvePayload());

    const response = await context.app.inject({
      method: 'DELETE',
      url: `/api/v1/solves/${created.json().solve.id}`,
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect(response.statusCode).toBe(204);

    const list = await context.app.inject({
      method: 'GET',
      url: '/api/v1/solves',
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(list.json().solves).toHaveLength(0);

    const row = await context.prisma.solve.findFirstOrThrow();
    expect(row.deletedAt).not.toBeNull();
  });
});

describe('GET /solves pagination', () => {
  /** Create `count` solves one second apart, oldest first. */
  async function createSolves(count: number) {
    const base = Date.parse('2026-09-18T12:00:00.000Z');
    for (let index = 0; index < count; index += 1) {
      await postSolve(
        solvePayload({
          durationMs: 10_000 + index,
          solvedAt: new Date(base + index * 1_000).toISOString(),
        }),
      );
    }
  }

  it('returns solves newest first', async () => {
    await createSolves(3);

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/solves',
      cookies: { [SESSION_COOKIE]: cookie },
    });

    const durations = response.json().solves.map((s: { durationMs: number }) => s.durationMs);
    expect(durations).toEqual([10_002, 10_001, 10_000]);
  });

  it('pages through every solve exactly once', async () => {
    await createSolves(7);

    const seen: number[] = [];
    let cursor: string | null = null;

    do {
      const url: string = `/api/v1/solves?limit=3${cursor === null ? '' : `&cursor=${cursor}`}`;
      const page = await context.app.inject({
        method: 'GET',
        url,
        cookies: { [SESSION_COOKIE]: cookie },
      });

      seen.push(...page.json().solves.map((s: { durationMs: number }) => s.durationMs));
      cursor = page.json().nextCursor;
    } while (cursor !== null);

    // No duplicates and no gaps — the property offset pagination loses the moment a new
    // row is inserted while someone is reading.
    expect(seen).toEqual([10_006, 10_005, 10_004, 10_003, 10_002, 10_001, 10_000]);
    expect(new Set(seen).size).toBe(7);
  });

  it('reports no next cursor on the last page', async () => {
    await createSolves(2);

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/solves?limit=10',
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect(response.json().nextCursor).toBeNull();
  });

  /**
   * Two solves can share a millisecond. Without the id tiebreak in the cursor
   * comparison, one of them is skipped or repeated at a page boundary.
   */
  it('handles solves recorded at the same instant', async () => {
    const sameInstant = new Date('2026-09-18T12:00:00.000Z').toISOString();
    for (let index = 0; index < 4; index += 1) {
      await postSolve(solvePayload({ durationMs: 20_000 + index, solvedAt: sameInstant }));
    }

    const seen: number[] = [];
    let cursor: string | null = null;

    do {
      const url: string = `/api/v1/solves?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
      const page = await context.app.inject({
        method: 'GET',
        url,
        cookies: { [SESSION_COOKIE]: cookie },
      });
      seen.push(...page.json().solves.map((s: { durationMs: number }) => s.durationMs));
      cursor = page.json().nextCursor;
    } while (cursor !== null);

    expect(new Set(seen).size).toBe(4);
  });

  it('filters to one practice session', async () => {
    await createSolves(2);

    const other = await context.app.inject({
      method: 'POST',
      url: '/api/v1/practice-sessions',
      cookies: { [SESSION_COOKIE]: cookie },
      payload: { name: 'One-handed' },
    });
    const otherId = other.json().practiceSession.id;

    await postSolve(solvePayload({ practiceSessionId: otherId, durationMs: 99_000 }));

    const response = await context.app.inject({
      method: 'GET',
      url: `/api/v1/solves?practiceSessionId=${otherId}`,
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect(response.json().solves).toHaveLength(1);
    expect(response.json().solves[0].durationMs).toBe(99_000);
  });

  it('rejects a malformed cursor rather than crashing', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/solves?cursor=not-a-real-cursor',
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_CURSOR');
  });
});
