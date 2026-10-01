import { describe, expect, it } from 'vitest';
import { createGeminiTextModel } from './gemini-text-model.js';
import { TextModelError, type TextModelRequest } from './text-model.js';

/**
 * The adapter against a stubbed `fetch`: no network, so each reply shape Gemini can send
 * is checked on purpose rather than by luck.
 */

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

function stub(...responses: (Response | Error)[]) {
  const sent: Sent[] = [];
  const fetchStub = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    const next = responses.shift();
    if (next === undefined) throw new Error('No more stubbed responses');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { sent, fetch: fetchStub };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const reply = (parts: unknown[], finishReason = 'STOP') =>
  json({
    candidates: [{ content: { role: 'model', parts }, finishReason }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  });

const request = (signal = new AbortController().signal): TextModelRequest => ({
  system: 'Be brief.',
  prompt: 'Explain R U',
  maxTokens: 400,
  signal,
});

async function failure(promise: Promise<unknown>): Promise<TextModelError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(TextModelError);
  return error as TextModelError;
}

describe('the Gemini adapter', () => {
  it('sends the system prompt, the prompt and the limit, with the key in a header', async () => {
    const { sent, fetch } = stub(reply([{ text: 'Hello.' }]));
    const model = createGeminiTextModel({ apiKey: 'test-key', model: 'gemini-x', fetch });

    expect(await model.generate(request())).toBe('Hello.');
    expect(model.id).toBe('gemini:gemini-x');

    const [call] = sent;
    expect(call?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent',
    );
    expect(call?.url).not.toContain('test-key');
    expect((call?.init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    expect(JSON.parse(call?.init.body as string)).toMatchObject({
      systemInstruction: { parts: [{ text: 'Be brief.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Explain R U' }] }],
      generationConfig: { maxOutputTokens: 400 },
    });
  });

  it('drops thought parts and joins the rest', async () => {
    const { fetch } = stub(
      reply([
        { text: 'Thinking about it…', thought: true },
        { text: 'First. ' },
        { text: 'Second.' },
      ]),
    );
    const model = createGeminiTextModel({ apiKey: 'k', model: 'm', fetch });
    expect(await model.generate(request())).toBe('First. Second.');
  });

  it('reports token usage from a successful reply', async () => {
    const usage: unknown[] = [];
    const { fetch } = stub(reply([{ text: 'Hi.' }]));
    const model = createGeminiTextModel({
      apiKey: 'k',
      model: 'm',
      fetch,
      onUsage: (u) => usage.push(u),
    });
    await model.generate(request());
    expect(usage).toEqual([{ promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }]);
  });

  it.each([
    ['a blocked prompt', json({ promptFeedback: { blockReason: 'SAFETY' } }), 'blocked'],
    ['a blocked reply', reply([{ text: 'x' }], 'SAFETY'), 'blocked'],
    [
      'a reply cut off at the token limit',
      reply([{ text: 'The pair' }], 'MAX_TOKENS'),
      'incomplete',
    ],
    ['no candidates', json({ candidates: [] }), 'empty'],
    ['only whitespace', reply([{ text: '  \n' }]), 'empty'],
    ['only thoughts', reply([{ text: 'hmm', thought: true }]), 'empty'],
    ['a bad key', json({ error: { code: 400 } }, 400), 'rejected'],
  ] as const)('turns %s into a %s failure', async (_, response, kind) => {
    const { fetch } = stub(response);
    const model = createGeminiTextModel({ apiKey: 'k', model: 'm', fetch });
    expect((await failure(model.generate(request()))).kind).toBe(kind);
  });

  it('does not retry a 429, which on a free tier means the quota is spent', async () => {
    const { sent, fetch } = stub(json({}, 429), reply([{ text: 'Too late.' }]));
    const model = createGeminiTextModel({ apiKey: 'k', model: 'm', fetch });

    const error = await failure(model.generate(request()));
    expect(error.kind).toBe('rate-limited');
    expect(error.status).toBe(429);
    expect(sent).toHaveLength(1);
  });

  it('retries a server error once', async () => {
    const { sent, fetch } = stub(json({}, 503), reply([{ text: 'Second time.' }]));
    const model = createGeminiTextModel({ apiKey: 'k', model: 'm', fetch });

    expect(await model.generate(request())).toBe('Second time.');
    expect(sent).toHaveLength(2);
  });

  it('gives up after one retry', async () => {
    const { sent, fetch } = stub(
      new TypeError('fetch failed'),
      json({}, 500),
      reply([{ text: 'x' }]),
    );
    const model = createGeminiTextModel({ apiKey: 'k', model: 'm', fetch });

    expect((await failure(model.generate(request()))).kind).toBe('unavailable');
    expect(sent).toHaveLength(2);
  });

  it('asks before retrying, and does not retry when the caller says no', async () => {
    const asked: boolean[] = [];
    const ask = (answer: boolean) => () => {
      asked.push(answer);
      return answer;
    };

    const refused = stub(json({}, 503), reply([{ text: 'x' }]));
    const noRetry = createGeminiTextModel({ apiKey: 'k', model: 'm', fetch: refused.fetch });
    const error = await failure(noRetry.generate({ ...request(), mayRetry: ask(false) }));
    expect(error.kind).toBe('unavailable');
    expect(refused.sent).toHaveLength(1);

    const allowed = stub(json({}, 503), reply([{ text: 'Second time.' }]));
    const retry = createGeminiTextModel({ apiKey: 'k', model: 'm', fetch: allowed.fetch });
    expect(await retry.generate({ ...request(), mayRetry: ask(true) })).toBe('Second time.');
    expect(allowed.sent).toHaveLength(2);

    // Never asked about a failure it would not retry anyway.
    const limited = stub(json({}, 429));
    const noAsk = createGeminiTextModel({ apiKey: 'k', model: 'm', fetch: limited.fetch });
    await failure(noAsk.generate({ ...request(), mayRetry: ask(true) }));
    expect(asked).toEqual([false, true]);
  });

  it('does not keep the original network error, which could describe the request', async () => {
    const { fetch } = stub(new TypeError('fetch failed for key k'), new TypeError('again k'));
    const model = createGeminiTextModel({ apiKey: 'k', model: 'm', fetch });

    const error = await failure(model.generate(request()));
    expect(error.message).not.toContain('key');
    expect(error.cause).toBeUndefined();
  });

  it('reports a passed deadline as a timeout and does not retry it', async () => {
    const controller = new AbortController();
    const { sent, fetch } = stub(new DOMException('aborted', 'AbortError'), reply([{ text: 'x' }]));
    const model = createGeminiTextModel({ apiKey: 'k', model: 'm', fetch });
    controller.abort();

    expect((await failure(model.generate(request(controller.signal)))).kind).toBe('timeout');
    expect(sent).toHaveLength(1);
  });
});
