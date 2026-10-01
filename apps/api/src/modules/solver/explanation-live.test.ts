/**
 * The live measurement in ADR-0022 §7: real calls to the configured model over seeded
 * solves on all six cross faces, reporting the refusal rate, the notation refused, the
 * tokens used and the latency. Passes when refusals stay under 5% of steps. If they do
 * not, the prompt is changed, not the gate.
 *
 * Skipped unless `EXPLANATION_LIVE=1`, because it spends real quota (about 100 requests)
 * and takes several minutes, since calls are spaced out to stay under the free tier's
 * per-minute limit:
 *
 *     EXPLANATION_LIVE=1 pnpm --filter @cube-coach/api exec vitest run src/modules/solver/explanation-live
 *
 * It calls the adapter directly rather than through the explainer, so the cache cannot
 * hide a refusal and the cap cannot cut the run short. The report is also written to
 * `explanation-live.txt` in the system temp directory.
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyMoves,
  chooseExplanation,
  createRandomMoveScrambleProvider,
  createSolvedCube,
  FACES,
  formatAlgorithm,
  solveCross,
  solveF2L,
  STANDARD_COLOUR_NAMES,
  type Move,
} from '@cube-coach/shared';
import { createGeminiTextModel, type GeminiUsage } from '../../ai/gemini-text-model.js';
import { TextModelError } from '../../ai/text-model.js';
import { loadConfig } from '../../config.js';
import {
  buildStepPrompt,
  EXPLAIN_PROMPT_VERSION,
  EXPLAIN_SYSTEM_PROMPT,
} from './explain-prompt.js';

const MAX_REFUSAL_RATE = 0.05;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

describe.runIf(process.env['EXPLANATION_LIVE'] === '1')('explanation model, live', () => {
  const solves = Number(process.env['EXPLANATION_LIVE_SOLVES'] ?? 20);
  // About 13 requests a minute: under the free tier's per-minute limit for Flash-Lite.
  const spacingMs = Number(process.env['EXPLANATION_LIVE_SPACING_MS'] ?? 4_500);

  it(
    `keeps refusals under ${MAX_REFUSAL_RATE * 100}% of steps`,
    { timeout: 3_600_000 },
    async () => {
      const config = loadConfig();
      if (config.GEMINI_API_KEY === undefined)
        throw new Error('EXPLANATION_LIVE needs GEMINI_API_KEY');

      const usage: GeminiUsage[] = [];
      const model = createGeminiTextModel({
        apiKey: config.GEMINI_API_KEY,
        model: config.EXPLANATION_MODEL,
        onUsage: (u) => usage.push(u),
      });

      const provider = createRandomMoveScrambleProvider({ random: seededRandom(2026) });
      const latencies: number[] = [];
      const refused: {
        scramble: string;
        step: number;
        unknown: readonly string[];
        text: string;
      }[] = [];
      const failures: Record<string, number> = {};
      const samples: string[] = [];
      let steps = 0;

      for (let solve = 0; solve < solves; solve += 1) {
        const scramble: Move[] = [...(await provider.generate()).moves];
        const face = FACES[solve % FACES.length]!;
        const start = applyMoves(createSolvedCube(), scramble);
        const cross = solveCross(start, face);
        const all = [cross, ...solveF2L(start, cross).steps];

        for (const [index, step] of all.entries()) {
          steps += 1;
          const began = performance.now();
          try {
            const text = await model.generate({
              system: EXPLAIN_SYSTEM_PROMPT,
              prompt: buildStepPrompt(step, STANDARD_COLOUR_NAMES),
              maxTokens: 400,
              signal: AbortSignal.timeout(6_000),
            });
            latencies.push(performance.now() - began);
            const explanation = chooseExplanation(step, text, STANDARD_COLOUR_NAMES);
            if (explanation.source === 'template' && explanation.reason === 'refused') {
              refused.push({
                scramble: formatAlgorithm(scramble),
                step: index,
                unknown: explanation.unknown,
                text,
              });
            } else if (samples.length < 6 && (index === 0 || index === 1)) {
              samples.push(
                `[${face} ${index === 0 ? 'cross' : 'pair'}] ${step.tokens.join(' ')}\n    ${text}`,
              );
            }
          } catch (error) {
            const kind =
              error instanceof TextModelError
                ? `${error.kind}${error.status ? ` ${error.status}` : ''}`
                : 'unexpected';
            failures[kind] = (failures[kind] ?? 0) + 1;
          }
          await wait(spacingMs);
        }
      }

      const answered = latencies.length;
      const sum = (key: keyof GeminiUsage) => usage.reduce((total, u) => total + (u[key] ?? 0), 0);
      const refusalRate = answered === 0 ? 1 : refused.length / answered;

      const report = [
        `model ${model.id}, prompt v${EXPLAIN_PROMPT_VERSION}, ${solves} solves, ${steps} steps`,
        `answered ${answered}, failed ${steps - answered} ${JSON.stringify(failures)}`,
        `refused ${refused.length} (${(refusalRate * 100).toFixed(1)}% of answered)`,
        `latency ms: median ${percentile(latencies, 50).toFixed(0)}  p95 ${percentile(latencies, 95).toFixed(0)}  max ${percentile(latencies, 100).toFixed(0)}`,
        `tokens per answered step: input ${(sum('promptTokenCount') / Math.max(answered, 1)).toFixed(0)}, ` +
          `output ${(sum('candidatesTokenCount') / Math.max(answered, 1)).toFixed(0)}, ` +
          `thinking ${(sum('thoughtsTokenCount') / Math.max(answered, 1)).toFixed(0)}`,
        '',
        'refusals:',
        ...refused.map(
          (r) => `  step ${r.step} of ${r.scramble}: ${r.unknown.join(' ')}\n    ${r.text}`,
        ),
        '',
        'samples:',
        ...samples.map((s) => `  ${s}`),
      ].join('\n');
      // Written to a file as well as the console: Vitest hides a passing test's output, and
      // the numbers are meant to be copied into ADR-0022.
      const reportPath = join(tmpdir(), 'explanation-live.txt');
      writeFileSync(reportPath, `${report}\n`);
      console.log(`${report}\n\nreport written to ${reportPath}`);

      expect(answered).toBeGreaterThan(steps / 2);
      expect(refusalRate).toBeLessThan(MAX_REFUSAL_RATE);
    },
  );
});
