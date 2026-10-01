/**
 * The one thing a model provider must implement (ADR-0022 §1).
 *
 * Text in, text out. It knows nothing about cubes, so every agent can share it, and it
 * has no streaming, tools, history or structured output, so every provider can implement
 * it. Those are added when a feature needs them, not before.
 */
export interface TextModel {
  /** Provider and model, such as `gemini:gemini-3.5-flash-lite`. Used in cache keys and logs. */
  readonly id: string;
  generate(request: TextModelRequest): Promise<string>;
}

export interface TextModelRequest {
  readonly system: string;
  readonly prompt: string;
  readonly maxTokens: number;
  /**
   * Aborted when the caller's deadline passes. An adapter must stop, retries included, and
   * reject with a `TextModelError` of kind `timeout`.
   */
  readonly signal: AbortSignal;
  /**
   * Asked before any retry, which is another request to the provider. `false` means fail
   * with the first error instead. A caller that budgets requests spends one here, so a
   * retry counts against its cap like the first attempt did. Left out, retries are allowed.
   */
  readonly mayRetry?: () => boolean;
}

/**
 * Why a call failed, in words every provider can map to:
 *
 * - `timeout`: the caller's deadline passed.
 * - `rate-limited`: the provider said too many requests, or the quota is spent (429).
 * - `unavailable`: the network failed, or the provider had a server error (5xx).
 * - `rejected`: the provider refused the request itself, such as a bad key or model (4xx).
 * - `blocked`: the provider's safety filter declined the prompt or the reply.
 * - `incomplete`: the reply stopped early, such as at the token limit.
 * - `empty`: the reply had no text.
 */
export type TextModelFailure =
  'timeout' | 'rate-limited' | 'unavailable' | 'rejected' | 'blocked' | 'incomplete' | 'empty';

/**
 * The single way a `TextModel` fails, so a caller has one path to handle. It carries a
 * kind and a status and never the request, so logging one cannot leak a key.
 */
export class TextModelError extends Error {
  override readonly name = 'TextModelError';

  constructor(
    readonly kind: TextModelFailure,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
