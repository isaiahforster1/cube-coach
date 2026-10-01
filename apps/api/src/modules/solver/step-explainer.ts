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
 * check (ADR-0023), the cache, the daily cap and the logs. The model behind it is a
 * `TextModel`, so another agent reuses the port and none of this. Whatever happens,
 * `explain` resolves with an explanation: a model
 * that fails, is refused, or is out of budget gives way to the template.
 */

/** The logger calls the explainer makes. Fastify's `request.log` fits. */
export interface ExplainerLog {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
}

export interface StepToExplain extends ExplainableStep {
  readonly kind: 'cross' | 'pair';
}

export interface StepExplainer {
  explain(step: StepToExplain, context: { index: number; log: ExplainerLog }): Promise<Explanation>;
}

export interface StepExplainerOptions {
  /** `null` when no model is configured: every step gets the template, and nothing is logged. */
  readonly model: TextModel | null;
  /** Model calls allowed per UTC day, cache hits not counted (ADR-0022 §5). */
  readonly dailyCallCap: number;
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

/**
 * Calls left today. The day is UTC, so the cap resets at one moment everywhere, whatever
 * the server's time zone.
 */
function createDailyBudget(cap: number, now: () => Date) {
  let day = '';
  let used = 0;
  let warned = false;

  const today = () => now().toISOString().slice(0, 10);
  const roll = () => {
    if (day !== today()) {
      day = today();
      used = 0;
      warned = false;
    }
  };

  return {
    /** Spend one call if there is one left. */
    take(): boolean {
      roll();
      if (used >= cap) return false;
      used += 1;
      return true;
    },
    /** True only the first time the cap is hit each day, so it is logged once. */
    firstRefusalToday(): boolean {
      if (warned) return false;
      warned = true;
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
  const { model, dailyCallCap } = options;
  const names = options.names ?? STANDARD_COLOUR_NAMES;
  const timeoutMs = options.timeoutMs ?? 6_000;
  const cache = createLruCache(options.cacheSize ?? 5_000);
  const budget = createDailyBudget(dailyCallCap, options.now ?? (() => new Date()));

  return {
    async explain(step, { index, log }) {
      if (model === null) return chooseExplanation(step, undefined, names);

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

      if (!budget.take()) {
        if (budget.firstRefusalToday()) {
          log.warn(
            { ...where, dailyCallCap },
            'Explanation model daily cap reached; using the template',
          );
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
