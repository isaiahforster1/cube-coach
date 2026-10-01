import { TextModelError, type TextModel, type TextModelRequest } from './text-model.js';

/**
 * What the fake does for one request: return text, throw an error, or never answer, so
 * the caller's deadline is what ends it.
 */
export type FakeReply = string | Error | 'hang';

export interface FakeTextModel extends TextModel {
  /** Every request received, in order. */
  readonly requests: TextModelRequest[];
}

/**
 * A `TextModel` for tests: no network, and the reply is chosen per request. Hanging
 * respects the abort signal the way a real adapter must, failing with the same `timeout`
 * error, so timeouts can be tested without waiting for a real one.
 */
export function createFakeTextModel(
  reply: (request: TextModelRequest) => FakeReply,
  id = 'fake:model',
): FakeTextModel {
  const requests: TextModelRequest[] = [];

  return {
    id,
    requests,
    generate(request) {
      requests.push(request);
      const answer = reply(request);
      if (answer === 'hang') {
        return new Promise((_, reject) => {
          request.signal.addEventListener(
            'abort',
            () => reject(new TextModelError('timeout', 'The model did not answer in time')),
            { once: true },
          );
        });
      }
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
}
