import { TextModelError, type TextModel, type TextModelRequest } from './text-model.js';

/**
 * The Gemini adapter (ADR-0022 §1), called with plain `fetch`.
 *
 * The only file that knows Gemini's request and reply shapes. Everything it can go wrong
 * with becomes a `TextModelError`, so the explainer never sees anything provider-specific.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Token counts from one reply, for the live measurement. */
export interface GeminiUsage {
  readonly promptTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly thoughtsTokenCount?: number;
  readonly totalTokenCount?: number;
}

export interface GeminiTextModelOptions {
  /** Passed in from config, never read from the environment here (ADR-0022 §4). */
  readonly apiKey: string;
  readonly model: string;
  /** Replaced in tests. */
  readonly fetch?: typeof fetch;
  /** Called with the token counts of every successful reply. */
  readonly onUsage?: (usage: GeminiUsage) => void;
}

/** The parts of Gemini's reply this adapter reads. Everything is optional: trust nothing. */
interface GeminiReply {
  readonly promptFeedback?: { readonly blockReason?: string };
  readonly candidates?: readonly {
    readonly finishReason?: string;
    readonly content?: {
      readonly parts?: readonly { readonly text?: unknown; readonly thought?: boolean }[];
    };
  }[];
  readonly usageMetadata?: GeminiUsage;
}

/** Finish reasons that mean a safety or policy filter stopped the reply. */
const BLOCKED_FINISH = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']);

function failureForStatus(status: number): TextModelError {
  if (status === 429)
    return new TextModelError('rate-limited', 'The model refused: too many requests', status);
  if (status >= 500)
    return new TextModelError('unavailable', `The model had a server error`, status);
  return new TextModelError('rejected', 'The model refused the request', status);
}

/** The reply's text, without thought parts, or the reason there is none. */
function textOf(reply: GeminiReply): string {
  if (reply.promptFeedback?.blockReason !== undefined) {
    throw new TextModelError(
      'blocked',
      `The prompt was blocked: ${reply.promptFeedback.blockReason}`,
    );
  }
  const candidate = reply.candidates?.[0];
  if (candidate === undefined) throw new TextModelError('empty', 'The reply had no candidates');

  const finish = candidate.finishReason ?? 'STOP';
  if (BLOCKED_FINISH.has(finish))
    throw new TextModelError('blocked', `The reply was blocked: ${finish}`);
  // A reply cut off at the token limit is half an explanation. Better the template.
  if (finish !== 'STOP')
    throw new TextModelError('incomplete', `The reply stopped early: ${finish}`);

  const text = (candidate.content?.parts ?? [])
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
    .trim();
  if (text === '') throw new TextModelError('empty', 'The reply had no text');
  return text;
}

export function createGeminiTextModel(options: GeminiTextModelOptions): TextModel {
  const send = options.fetch ?? fetch;
  const url = `${API_BASE}/${encodeURIComponent(options.model)}:generateContent`;

  async function attempt(request: TextModelRequest): Promise<string> {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        // Rewriting checked facts needs no reasoning, and thinking spends output tokens.
        thinkingConfig: { thinkingLevel: 'minimal' },
      },
    });

    try {
      // The key goes in a header, never the URL, where proxies and access logs keep it.
      const response = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
        body,
        signal: request.signal,
      });
      if (!response.ok) throw failureForStatus(response.status);

      const reply = (await response.json()) as GeminiReply;
      const text = textOf(reply);
      if (reply.usageMetadata !== undefined) options.onUsage?.(reply.usageMetadata);
      return text;
    } catch (error) {
      if (error instanceof TextModelError) throw error;
      if (request.signal.aborted)
        throw new TextModelError('timeout', 'The model did not answer in time');
      // A network failure, or a body that was not JSON. The original error is not kept:
      // it can describe the request, and the request carries the key.
      throw new TextModelError('unavailable', 'The model could not be reached');
    }
  }

  return {
    id: `gemini:${options.model}`,
    async generate(request) {
      try {
        return await attempt(request);
      } catch (error) {
        // One retry, only for a failure that might not happen twice, and only while the
        // caller's deadline has time left. A 429 is not retried: on a free tier it usually
        // means the quota is spent, and asking again spends more of it (ADR-0022 §6).
        const retryable = error instanceof TextModelError && error.kind === 'unavailable';
        if (!retryable || request.signal.aborted) throw error;
        return attempt(request);
      }
    },
  };
}
