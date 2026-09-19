import { createRandomMoveScrambleProvider } from './random-move.js';
import { createRandomStateScrambleProvider } from './random-state.js';
import type { Scramble, ScrambleProvider } from './types.js';

export interface ResilientScrambleOptions {
  readonly primary?: ScrambleProvider;
  readonly fallback?: ScrambleProvider;
  /**
   * How long to wait for a competition-quality scramble before giving up on it.
   *
   * Generous, because the first one has to download and start a WebAssembly solver on
   * whatever connection the user has. Short enough that a timer which will never get a
   * scramble does not simply sit there.
   */
  readonly timeoutMs?: number;
  /** Injectable for tests, which should not wait five seconds to prove a timeout. */
  readonly delay?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 5000;

type Scheduler = (run: () => void, ms: number) => unknown;

/**
 * Competition-quality scrambles, with a working timer as the floor.
 *
 * The good scrambles come from a solver running in a worker
 * ([ADR-0004](../../../docs/architecture/0004-scramble-generation.md)), and a worker is
 * not something a web page is guaranteed to get. Strict browser settings block them,
 * some corporate policies block them, and a content security policy can block them by
 * accident — which is exactly what happened the first time this application was built
 * and run as it would be deployed.
 *
 * When that happens the honest failure is *not* an empty timer. A cuber who came to
 * practise should get scrambles; the thing worth protecting is that they are told the
 * scrambles are the weaker kind, not that they are withheld. Every `Scramble` carries
 * its own `quality`, so the interface can say so.
 *
 * The first failure is remembered. Retrying a broken solver on every single solve would
 * add the timeout to every scramble, which is a worse experience than the fallback.
 */
export function createResilientScrambleProvider(
  options: ResilientScrambleOptions = {},
): ScrambleProvider {
  const {
    primary = createRandomStateScrambleProvider(),
    fallback = createRandomMoveScrambleProvider(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    delay = defaultDelay,
  } = options;

  let primaryIsBroken = false;

  return {
    quality: primary.quality,

    async generate(): Promise<Scramble> {
      if (primaryIsBroken) return fallback.generate();

      try {
        return await withTimeout(primary.generate(), timeoutMs, delay);
      } catch {
        // Deliberately swallowed. There is nothing the caller can do about a missing
        // worker, and the fallback is a real answer rather than an apology.
        primaryIsBroken = true;
        return fallback.generate();
      }
    },
  };
}

class ScrambleTimeoutError extends Error {
  constructor(ms: number) {
    super(`No scramble after ${ms}ms`);
    this.name = 'ScrambleTimeoutError';
  }
}

async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  delay: (ms: number) => Promise<void>,
): Promise<T> {
  // A hung worker never rejects — it simply never answers — so a plain `catch` would
  // wait for ever. The race is what turns silence into a failure.
  return Promise.race([
    work,
    delay(ms).then(() => {
      throw new ScrambleTimeoutError(ms);
    }),
  ]);
}

function defaultDelay(ms: number): Promise<void> {
  /**
   * Reached through `globalThis` deliberately.
   *
   * This package is typed without the DOM or Node libraries (ADR-0002) so that it can
   * run in either, and the two disagree about what `setTimeout` returns — a number in
   * the browser, a `Timeout` object in Node. Every runtime has the function; only the
   * typings are in dispute, so the return value is simply not named.
   */
  const schedule = (globalThis as unknown as Record<'setTimeout', Scheduler>).setTimeout;

  return new Promise((resolve) => {
    schedule(() => resolve(), ms);
  });
}
