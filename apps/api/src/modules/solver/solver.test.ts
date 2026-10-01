import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyMoves,
  checkNotation,
  createSolvedCube,
  parseAlgorithm,
  solveCross,
  solveF2L,
  type SolverStepsResponse,
} from '@cube-coach/shared';
import { createFakeTextModel } from '../../ai/fake-text-model.js';
import { createTestContext, type TestContext } from '../../test/context.js';
import { SESSION_COOKIE } from '../auth/auth.cookie.js';

let context: TestContext;

beforeEach(async () => {
  context ??= await createTestContext();
  await context.reset();
});

afterAll(async () => {
  await context?.close();
});

const SCRAMBLE = "D2 R2 B2 U' L2 D F2 U2 R2 B' L' U R' F D2 L B' U2 R";

function steps(query: string) {
  return context.app.inject({ method: 'GET', url: `/api/v1/solver/steps?${query}` });
}

describe('GET /solver/steps', () => {
  /**
   * The solver's correctness is proved in `packages/shared` against the sticker oracle.
   * What this proves is that the route hands it the right cube and passes the answer
   * through intact, so the expected tokens come from calling the solver directly.
   */
  it('returns the cross and each pair, as the solver produced them, without an account', async () => {
    const response = await steps(`scramble=${encodeURIComponent(SCRAMBLE)}`);
    expect(response.statusCode).toBe(200);

    const body: SolverStepsResponse = response.json();
    const start = applyMoves(createSolvedCube(), parseAlgorithm(SCRAMBLE));
    const cross = solveCross(start, 'D');
    const f2l = solveF2L(start, cross);

    expect(body.crossFace).toBe('D');
    expect(body.status).toBe('solved');
    expect(body.steps.map((step) => step.kind)).toEqual(['cross', ...f2l.steps.map(() => 'pair')]);
    expect(body.steps.map((step) => step.tokens)).toEqual([
      cross.tokens,
      ...f2l.steps.map((step) => step.tokens),
    ]);
  });

  it('explains every step with the template, which passes the notation gate', async () => {
    const body: SolverStepsResponse = (
      await steps(`scramble=${encodeURIComponent(SCRAMBLE)}`)
    ).json();

    for (const step of body.steps) {
      expect(step.explanation.source).toBe('template');
      expect(step.explanation.text).not.toBe('');
      expect(checkNotation(step.explanation.text, step.tokens)).toEqual({ ok: true });
    }
    expect(body.steps[0]?.explanation.text).toMatch(/yellow cross/u);
  });

  it('solves on the cross face asked for, starting with the rotation that puts it down', async () => {
    const body: SolverStepsResponse = (
      await steps(`scramble=${encodeURIComponent(SCRAMBLE)}&crossFace=U`)
    ).json();

    expect(body.crossFace).toBe('U');
    expect(body.steps[0]?.tokens[0]).toBe('z2');
    expect(body.steps[0]?.explanation.text).toMatch(/white cross/u);
  });

  it.each([
    ['a rotation in the scramble', `scramble=${encodeURIComponent('R y U')}`],
    ['no scramble', ''],
    ['an unknown cross face', 'scramble=R&crossFace=Q'],
  ])('refuses %s as a validation failure', async (_, query) => {
    const response = await steps(query);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses an overlong scramble before solving anything', async () => {
    const response = await steps(`scramble=${encodeURIComponent('R '.repeat(300))}`);
    expect(response.statusCode).toBe(400);
  });
});

/** Register an account and return its session cookie, verifying its email if asked. */
async function signUp(app: TestContext, email: string, verified: boolean): Promise<string> {
  const response = await app.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'a-long-enough-password', displayName: 'Test Cuber' },
  });
  const cookie = response.cookies.find((candidate) => candidate.name === SESSION_COOKIE);
  if (cookie === undefined) throw new Error('No session cookie was set');
  if (verified) {
    await app.prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  }
  return cookie.value;
}

function stepsAs(app: TestContext, cookie: string | undefined, scramble = SCRAMBLE) {
  return app.app.inject({
    method: 'GET',
    url: `/api/v1/solver/steps?scramble=${encodeURIComponent(scramble)}`,
    ...(cookie === undefined ? {} : { cookies: { [SESSION_COOKIE]: cookie } }),
  });
}

describe('GET /solver/steps with a model', () => {
  let withModel: TestContext | undefined;

  afterAll(async () => {
    await withModel?.close();
  });

  /**
   * ADR-0022 §3: a refused text and the reason for refusing it stay on the server. The
   * fake writes a text the gate refuses for the cross, and a passing one for every pair.
   */
  it('sends the model’s text where it passes and the template where it is refused, and nothing else', async () => {
    const REFUSED = 'Start with r M2 and the cross falls into place.';
    const model = createFakeTextModel((request) =>
      request.prompt.startsWith('Step: the cross')
        ? REFUSED
        : `Do ${/Moves, in order: (.*)\n/u.exec(request.prompt)?.[1] ?? ''} to insert the pair.`,
    );
    withModel = await createTestContext({ textModel: model });
    const cookie = await signUp(withModel, 'cuber@example.com', true);

    const response = await stepsAs(withModel, cookie);
    expect(response.statusCode).toBe(200);
    const body: SolverStepsResponse = response.json();

    expect(body.steps[0]?.explanation.source).toBe('template');
    expect(body.steps[0]?.explanation.text).toMatch(/yellow cross/u);
    for (const step of body.steps.slice(1)) expect(step.explanation.source).toBe('model');
    for (const step of body.steps)
      expect(Object.keys(step.explanation).sort()).toEqual(['source', 'text']);

    expect(response.body).not.toContain(REFUSED);
    expect(response.body).not.toContain('M2');
    expect(response.body).not.toContain('unknown');
    expect(response.body).not.toContain('refused');
    expect(model.requests).toHaveLength(body.steps.length);
  });
});

/**
 * ADR-0022 §5, amended: model explanations are for accounts, and each client has its own
 * daily share. Every inject() comes from the same address, which is what makes the
 * unverified accounts here share one budget.
 */
describe('GET /solver/steps model budget', () => {
  let budgeted: TestContext;
  // Refused by the gate, so nothing is cached and every request asks the model again.
  const model = createFakeTextModel(() => 'Start with r M2.');
  const STEPS = 5; // the cross and four pairs

  beforeEach(async () => {
    budgeted ??= await createTestContext({
      textModel: model,
      env: { EXPLANATION_DAILY_CALL_CAP: '1000', EXPLANATION_CLIENT_DAILY_CALL_CAP: `${STEPS}` },
    });
    await budgeted.reset();
  });

  afterAll(async () => {
    await budgeted?.close();
  });

  it('gives a guest the solve with template explanations, without calling the model', async () => {
    const before = model.requests.length;
    const response = await stepsAs(budgeted, undefined);

    expect(response.statusCode).toBe(200);
    const body: SolverStepsResponse = response.json();
    expect(body.steps).toHaveLength(STEPS);
    for (const step of body.steps) expect(step.explanation.source).toBe('template');
    expect(model.requests.length).toBe(before);
  });

  it('treats a stale session cookie as a guest rather than refusing the request', async () => {
    const before = model.requests.length;
    const response = await stepsAs(budgeted, 'not-a-real-session');

    expect(response.statusCode).toBe(200);
    expect(model.requests.length).toBe(before);
  });

  it('gives each verified account its own budget, even from one address', async () => {
    const alice = await signUp(budgeted, 'alice@example.com', true);
    const bob = await signUp(budgeted, 'bob@example.com', true);
    const before = model.requests.length;

    await stepsAs(budgeted, alice);
    expect(model.requests.length - before).toBe(STEPS);
    await stepsAs(budgeted, alice); // Alice's share is spent
    expect(model.requests.length - before).toBe(STEPS);
    await stepsAs(budgeted, bob); // Bob's is not
    expect(model.requests.length - before).toBe(2 * STEPS);
  });

  it('makes unverified accounts at one address share that address’s budget', async () => {
    const first = await signUp(budgeted, 'first@example.com', false);
    const second = await signUp(budgeted, 'second@example.com', false);
    const before = model.requests.length;

    await stepsAs(budgeted, first);
    expect(model.requests.length - before).toBe(STEPS);
    await stepsAs(budgeted, second);
    expect(model.requests.length - before).toBe(STEPS);
  });
});

describe('GET /solver/steps rate limit', () => {
  let limited: TestContext | undefined;

  afterAll(async () => {
    await limited?.close();
  });

  it('has its own ceiling, below the global one', async () => {
    limited = await createTestContext({ rateLimit: { solverMax: 2 } });
    const request = () =>
      limited!.app.inject({ method: 'GET', url: '/api/v1/solver/steps?scramble=R' });

    expect((await request()).statusCode).toBe(200);
    expect((await request()).statusCode).toBe(200);
    expect((await request()).statusCode).toBe(429);
  });
});
