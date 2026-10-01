import { createHash } from 'node:crypto';
import {
  chooseExplanation,
  STANDARD_COLOUR_NAMES,
  type ColourNames,
  type ExplainableStep,
  type Explanation,
} from '@cube-coach/shared';
import { TextModelError, type TextModel } from '../../ai/text-model.js';
import {
  buildStepPrompt,
  EXPLAIN_PROMPT_VERSION,
  EXPLAIN_SYSTEM_PROMPT,
} from './explain-prompt.js';

/**
 * The step explanation agent (ADR-0022 §1).
 *
 * Everything specific to explaining steps lives here: the prompt, the gate and the fact
 * check (ADR-0023), the cache, the daily caps and the logs. The model behind it is a
 * `TextModel`, so another agent reuses the port and none of this. Whatever happens,
 * `explain` resolves with an explanation: a guest, or a model that fails, is refused, or
 * is out of budget, gets the template.
 */

/** The logger calls the explainer makes. Fastify's `request.log` fits. */
export interface ExplainerLog {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
}

export interface StepToExplain extends ExplainableStep {
  readonly kind: 'cross' | 'pair';
}

export interface ExplainContext {
  readonly index: number;
  readonly log: ExplainerLog;
  /**
   * Whose daily budget a model call spends, from `explanationClient`, or `null` for a
   * guest, who gets the template without the model or the cache (ADR-0022 §5).
   */
  readonly client: string | null;
}

export interface StepExplainer {
  explain(step: StepToExplain, context: ExplainContext): Promise<Explanation>;
}

export interface StepExplainerOptions {
  /** `null` when no model is configured: every step gets the template, and nothing is logged. */
  readonly model: TextModel | null;
  /** Model calls allowed per UTC day, cache hits not counted (ADR-0022 §5). */
  readonly dailyCallCap: number;
  /** The share of `dailyCallCap` any one client may spend in a UTC day. At least 1. */
  readonly clientDailyCallCap: number;
  readonly names?: ColourNames;
  /** One deadline per step, covering any retry the adapter makes (ADR-0022 §6). */
  readonly timeoutMs?: number;
  readonly cacheSize?: number;
  /** Replaced in tests, to cross midnight. */
  readonly now?: () => Date;
}

const MAX_TOKENS = 400;
const REFUSED_TEXT_LIMIT = 500;

/**
 * A least-recently-used cache in a `Map`, which iterates in insertion order: reading an
 * entry moves it to the end, so the first key is always the one to evict.
 */
function createLruCache(capacity: number) {
  const entries = new Map<string, string>();
  return {
    get(key: string): string | undefined {
      const value = entries.get(key);
      if (value !== undefined) {
        entries.delete(key);
        entries.set(key, value);
      }
      return value;
    },
    set(key: string, value: string): void {
      entries.delete(key);
      entries.set(key, value);
      if (entries.size > capacity) entries.delete(entries.keys().next().value!);
    },
  };
}

/** Which cap refused a call, so the right one is logged. */
type Refusal = 'global' | 'client';

/**
 * Calls left today, for everyone and for each client. The day is UTC, so the caps reset
 * at one moment everywhere, whatever the server's time zone.
 *
 * Both caps are checked before either is spent. A call that one cap refuses spends nothing
 * from the other: a client loses none of its share on a day the global cap has already
 * run out, and a client past its own share takes nothing more from everyone else.
 *
 * A client is recorded only when a call is spent, so the map never holds more than `cap`
 * clients, however many addresses someone rotates through.
 */
function createDailyBudget(cap: number, clientCap: number, now: () => Date) {
  let day = '';
  let used = 0;
  const usedBy = new Map<string, number>();
  let warnedGlobal = false;
  const warnedClients = new Set<string>();

  const today = () => now().toISOString().slice(0, 10);
  const roll = () => {
    if (day !== today()) {
      day = today();
      used = 0;
      usedBy.clear();
      warnedGlobal = false;
      warnedClients.clear();
    }
  };

  return {
    /** Spend one call for `client` if both caps have one left; otherwise say which refused. */
    take(client: string): Refusal | null {
      roll();
      if (used >= cap) return 'global';
      const clientUsed = usedBy.get(client) ?? 0;
      if (clientUsed >= clientCap) return 'client';
      used += 1;
      usedBy.set(client, clientUsed + 1);
      return null;
    },
    /**
     * True only the first time each cap refuses each day (each client, for the client
     * cap), so a refusal is logged once rather than for every step after it. A client is
     * only refused by its own cap once it is in `usedBy`, so this set is bounded too.
     */
    firstRefusalToday(refusal: Refusal, client: string): boolean {
      if (refusal === 'global') {
        if (warnedGlobal) return false;
        warnedGlobal = true;
        return true;
      }
      if (warnedClients.has(client)) return false;
      warnedClients.add(client);
      return true;
    },
  };
}

/** What can be logged about a failure: its kind and status, never the error whole. */
function failureDetails(error: unknown): object {
  if (error instanceof TextModelError) {
    return { failure: error.kind, ...(error.status === undefined ? {} : { status: error.status }) };
  }
  return { failure: 'unexpected', errorClass: error instanceof Error ? error.name : typeof error };
}

export function createStepExplainer(options: StepExplainerOptions): StepExplainer {
  const { model, dailyCallCap, clientDailyCallCap } = options;
  const names = options.names ?? STANDARD_COLOUR_NAMES;
  const timeoutMs = options.timeoutMs ?? 6_000;
  const cache = createLruCache(options.cacheSize ?? 5_000);
  const budget = createDailyBudget(
    dailyCallCap,
    clientDailyCallCap,
    options.now ?? (() => new Date()),
  );

  return {
    async explain(step, { index, log, client }) {
      // Model explanations are for accounts. A guest gets the template, even for a step
      // that is cached: a hit is free, but whether a guest saw model text would then
      // depend on which scrambles signed-in users happened to solve first.
      if (model === null || client === null) return chooseExplanation(step, undefined, names);

      const prompt = buildStepPrompt(step, names);
      // Everything that decides the reply, and nothing else. Two scrambles that reach the
      // same step share one entry.
      const key = createHash('sha256')
        .update(JSON.stringify([EXPLAIN_PROMPT_VERSION, model.id, prompt]))
        .digest('hex');

      const cached = cache.get(key);
      if (cached !== undefined) return chooseExplanation(step, cached, names);

      const where = {
        step: index,
        kind: step.kind,
        model: model.id,
        promptVersion: EXPLAIN_PROMPT_VERSION,
      };

      const refusal = budget.take(client);
      if (refusal !== null) {
        // The client key is not logged: it is a user id or an address, and the request
        // log already records the address.
        if (budget.firstRefusalToday(refusal, client)) {
          if (refusal === 'global') {
            log.warn(
              { ...where, dailyCallCap },
              'Explanation model daily cap reached; using the template',
            );
          } else {
            log.warn(
              { ...where, clientDailyCallCap },
              'Explanation client daily cap reached; using the template',
            );
          }
        }
        return chooseExplanation(step, undefined, names);
      }

      let text: string;
      try {
        text = await model.generate({
          system: EXPLAIN_SYSTEM_PROMPT,
          prompt,
          maxTokens: MAX_TOKENS,
          signal: AbortSignal.timeout(timeoutMs),
          // A retry is a second request to the provider's quota, so it spends both caps too.
          mayRetry: () => budget.take(client) === null,
        });
      } catch (error) {
        log.warn(
          { ...where, ...failureDetails(error) },
          'Explanation model failed; using the template',
        );
        return chooseExplanation(step, undefined, names);
      }

      const explanation = chooseExplanation(step, text, names);
      const refusedText = text.slice(0, REFUSED_TEXT_LIMIT);
      if (explanation.source === 'model') {
        // Only text that passed both checks is kept. A refusal is tried again next time.
        cache.set(key, text);
      } else if (explanation.reason === 'refused') {
        log.warn(
          { ...where, unknown: explanation.unknown, refusedText },
          'Explanation refused by the notation gate; using the template',
        );
      } else if (explanation.reason === 'contradicted') {
        log.warn(
          { ...where, mismatches: explanation.mismatches, refusedText },
          'Explanation contradicted the step facts; using the template',
        );
      }
      return explanation;
    },
  };
}
