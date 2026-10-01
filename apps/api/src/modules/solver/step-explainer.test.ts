import { describe, expect, it } from 'vitest';
import {
  applyMoves,
  createSolvedCube,
  parseAlgorithm,
  solveCross,
  solveF2L,
  STANDARD_COLOUR_NAMES,
  templateExplanation,
} from '@cube-coach/shared';
import { createFakeTextModel, type FakeReply } from '../../ai/fake-text-model.js';
import { TextModelError } from '../../ai/text-model.js';
import { EXPLAIN_PROMPT_VERSION } from './explain-prompt.js';
import { createStepExplainer, type ExplainerLog, type StepToExplain } from './step-explainer.js';

const start = applyMoves(
  createSolvedCube(),
  parseAlgorithm("D2 R2 B2 U' L2 D F2 U2 R2 B' L' U R' F D2 L B' U2 R"),
);
const cross = solveCross(start, 'D');
const pairs = solveF2L(start, cross).steps;

const CROSS: StepToExplain = { kind: 'cross', tokens: cross.tokens, facts: cross.facts };
const PAIR: StepToExplain = { kind: 'pair', tokens: pairs[0]!.tokens, facts: pairs[0]!.facts };

/** A model text that passes the gate: it names only the step's own moves. */
const goodText = (step: StepToExplain) => `Turn ${step.tokens.join(' ')} to place the pieces.`;
/** A model text the gate refuses: it adds a move no step here contains. */
const REFUSED = 'Do r M2 then sit back.';

function recordingLog() {
  const entries: { level: 'info' | 'warn'; details: Record<string, unknown>; message: string }[] =
    [];
  const log: ExplainerLog = {
    info: (details, message) => entries.push({ level: 'info', details: { ...details }, message }),
    warn: (details, message) => entries.push({ level: 'warn', details: { ...details }, message }),
  };
  return { log, entries };
}

function setup(
  reply: (prompt: string) => FakeReply,
  options: { cap?: number; now?: () => Date } = {},
) {
  const model = createFakeTextModel((request) => reply(request.prompt));
  const explainer = createStepExplainer({
    model,
    dailyCallCap: options.cap ?? 100,
    timeoutMs: 50,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const { log, entries } = recordingLog();
  const explain = (step: StepToExplain, index = 0) => explainer.explain(step, { index, log });
  return { model, explain, entries };
}

const template = (step: StepToExplain) => templateExplanation(step, STANDARD_COLOUR_NAMES);

describe('the step explainer', () => {
  it('uses the model’s text when it passes the gate', async () => {
    const { explain, model } = setup(() => goodText(PAIR));
    expect(await explain(PAIR)).toEqual({ source: 'model', text: goodText(PAIR) });
    expect(model.requests[0]?.maxTokens).toBe(400);
  });

  it('falls back to the template and logs why when the gate refuses the text', async () => {
    const { explain, entries } = setup(() => REFUSED);
    const result = await explain(PAIR, 3);

    expect(result.source).toBe('template');
    expect(result.text).toBe(template(PAIR));
    expect(entries).toEqual([
      {
        level: 'warn',
        message: 'Explanation refused by the notation gate; using the template',
        details: {
          step: 3,
          kind: 'pair',
          model: 'fake:model',
          promptVersion: EXPLAIN_PROMPT_VERSION,
          unknown: ['r', 'M2'],
          refusedText: REFUSED,
        },
      },
    ]);
  });

  it('falls back to the template and logs what did not match when the text contradicts a fact', async () => {
    // PAIR's chosen pair is orange–green, at front left before its `y'` and front right after.
    const CONTRADICTED = 'The orange–green pair at back left goes first.';
    const { explain, entries } = setup(() => CONTRADICTED);
    const result = await explain(PAIR, 1);

    expect(result.source).toBe('template');
    expect(result.text).toBe(template(PAIR));
    expect(entries).toEqual([
      {
        level: 'warn',
        message: 'Explanation contradicted the step facts; using the template',
        details: {
          step: 1,
          kind: 'pair',
          model: 'fake:model',
          promptVersion: EXPLAIN_PROMPT_VERSION,
          mismatches: [
            {
              claim: 'pair-place',
              said: 'orange-green pair at back left',
              allowed: ['front-left', 'front-right'],
            },
          ],
          refusedText: CONTRADICTED,
        },
      },
    ]);
  });

  it('does not cache a contradicted text, so the next request asks again', async () => {
    const { explain, model } = setup(() => 'The orange–green pair at back left goes first.');
    await explain(PAIR);
    await explain(PAIR);
    expect(model.requests).toHaveLength(2);
  });

  it('cuts the refused text to 500 characters in the log', async () => {
    const { explain, entries } = setup(() => `${REFUSED} ${'and so on '.repeat(100)}`);
    await explain(PAIR);
    expect(entries[0]?.details['refusedText']).toHaveLength(500);
  });

  it.each([
    [
      'throws',
      () => new TextModelError('rate-limited', 'no', 429),
      { failure: 'rate-limited', status: 429 },
    ],
    ['misses the deadline', () => 'hang' as const, { failure: 'timeout' }],
    [
      'throws something unexpected',
      () => new RangeError('bug'),
      { failure: 'unexpected', errorClass: 'RangeError' },
    ],
  ])(
    'falls back to the template when the model %s, logging only the kind',
    async (_, reply, details) => {
      const { explain, entries } = setup(reply);
      expect(await explain(CROSS)).toEqual({
        source: 'template',
        text: template(CROSS),
        reason: 'no-model',
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.message).toBe('Explanation model failed; using the template');
      expect(entries[0]?.details).toMatchObject(details);
    },
  );

  it('serves the same step from the cache, so the model is called once', async () => {
    const { explain, model } = setup(() => goodText(CROSS));
    const first = await explain(CROSS);
    const second = await explain(structuredClone(CROSS));

    expect(second).toEqual(first);
    expect(model.requests).toHaveLength(1);
  });

  it('does not cache a refusal or a failure, so the next request tries again', async () => {
    const replies: FakeReply[] = [
      REFUSED,
      new TextModelError('unavailable', 'down'),
      goodText(PAIR),
    ];
    const { explain, model } = setup(() => replies.shift()!);

    expect((await explain(PAIR)).source).toBe('template');
    expect((await explain(PAIR)).source).toBe('template');
    expect((await explain(PAIR)).source).toBe('model');
    expect(model.requests).toHaveLength(3);
  });

  it('stops calling the model at the daily cap and warns once', async () => {
    const { explain, model, entries } = setup(() => REFUSED, { cap: 2 });
    for (let i = 0; i < 4; i += 1) expect((await explain(PAIR)).source).toBe('template');

    expect(model.requests).toHaveLength(2);
    const capWarnings = entries.filter((entry) => entry.message.includes('daily cap'));
    expect(capWarnings).toHaveLength(1);
    expect(capWarnings[0]?.details['dailyCallCap']).toBe(2);
  });

  it('does not count cache hits toward the cap', async () => {
    const { explain, model } = setup(() => goodText(CROSS), { cap: 1 });
    for (let i = 0; i < 3; i += 1) expect((await explain(CROSS)).source).toBe('model');
    expect(model.requests).toHaveLength(1);
  });

  it('starts a new allowance at midnight UTC', async () => {
    let now = new Date('2026-09-30T23:59:00Z');
    const { explain, model } = setup(() => REFUSED, { cap: 1, now: () => now });

    await explain(PAIR);
    await explain(PAIR);
    expect(model.requests).toHaveLength(1);

    now = new Date('2026-10-01T00:00:01Z');
    await explain(PAIR);
    expect(model.requests).toHaveLength(2);
  });

  it('never calls anything or logs anything without a model', async () => {
    const explainer = createStepExplainer({ model: null, dailyCallCap: 100 });
    const { log, entries } = recordingLog();

    expect(await explainer.explain(PAIR, { index: 0, log })).toEqual({
      source: 'template',
      text: template(PAIR),
      reason: 'no-model',
    });
    expect(entries).toEqual([]);
  });

  it('evicts the least recently used entry when the cache is full', async () => {
    const model = createFakeTextModel((request) =>
      request.prompt.includes('the cross') ? goodText(CROSS) : goodText(PAIR),
    );
    const explainer = createStepExplainer({ model, dailyCallCap: 100, cacheSize: 1 });
    const { log } = recordingLog();
    const explain = (step: StepToExplain) => explainer.explain(step, { index: 0, log });

    await explain(CROSS);
    await explain(PAIR); // evicts the cross
    await explain(PAIR); // a hit
    await explain(CROSS); // a miss again
    expect(model.requests).toHaveLength(3);
  });
});
