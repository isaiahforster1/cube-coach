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

    const response = await withModel.app.inject({
      method: 'GET',
      url: `/api/v1/solver/steps?scramble=${encodeURIComponent(SCRAMBLE)}`,
    });
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
