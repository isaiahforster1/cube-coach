/**
 * The performance budget in ADR-0021 ("Where it lives"): one full cross plus F2L, p95
 * under 200 ms in Node, over 500 seeded scrambles solved on all six cross faces. Table
 * building is timed separately and reported.
 *
 * Skipped unless `SOLVER_TIMING=1`, because it takes about a minute:
 *
 *     SOLVER_TIMING=1 pnpm --filter @cube-coach/shared exec vitest run src/solver/timing
 */
import { describe, expect, it } from 'vitest';
import { applyMoves, applySequence, createSolvedCube } from '../cube/cube.js';
import { at } from '../cube/permutations.js';
import { FACES, type Move } from '../cube/types.js';
import { crossDistanceTable } from '../analysis/cross.js';
import { createRandomMoveScrambleProvider } from '../scramble/random-move.js';
import { solveCross } from './cross.js';
import { prepareF2L, solveF2L } from './f2l.js';
import { isFirstTwoLayersSolved } from './oracle.js';

// The shared package is platform-neutral, so it has no Node or DOM types. This file only
// ever runs under Vitest in Node; these are the globals it needs.
declare const performance: { now(): number };
declare const console: { log(message: string): void };
declare const process: { version: string; env: Record<string, string | undefined> };

const BUDGET_P95_MS = 200;

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

async function scrambles(count: number, seed: number): Promise<Move[][]> {
  const provider = createRandomMoveScrambleProvider({ random: seededRandom(seed) });
  const result: Move[][] = [];
  for (let i = 0; i < count; i += 1) result.push([...(await provider.generate()).moves]);
  return result;
}

function percentile(sorted: readonly number[], p: number): number {
  return at(sorted, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
}

function summarise(label: string, values: readonly number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return `${label.padEnd(24)} median ${f(percentile(sorted, 50))}  p95 ${f(
    percentile(sorted, 95),
  )}  p99 ${f(percentile(sorted, 99))}  max ${f(at(sorted, sorted.length - 1))}`;
}

describe.runIf(process.env.SOLVER_TIMING === '1')('solver timing budget', () => {
  const count = Number(process.env.SOLVER_TIMING_SCRAMBLES ?? 500);

  it(`solves cross + F2L with p95 under ${BUDGET_P95_MS} ms`, { timeout: 3_600_000 }, async () => {
    const crossStart = performance.now();
    for (const face of FACES) crossDistanceTable(face);
    const crossMs = performance.now() - crossStart;
    const pairStart = performance.now();
    for (const face of FACES) prepareF2L(face);
    const pairMs = performance.now() - pairStart;

    const starts = (await scrambles(count, 2026)).flatMap((scramble) =>
      FACES.map((face) => ({ face, state: applyMoves(createSolvedCube(), scramble) })),
    );

    // Warm the JIT so the first solves do not count compilation time.
    for (const { face, state } of starts.slice(0, 30)) solveF2L(state, solveCross(state, face));

    const solveMs: number[] = [];
    const nodes: number[] = [];
    const inserts: number[] = [];
    const totals: number[] = [];
    let failures = 0;

    for (const { face, state } of starts) {
      const t0 = performance.now();
      const cross = solveCross(state, face);
      const f2l = solveF2L(state, cross);
      solveMs.push(performance.now() - t0);

      if (f2l.status === 'failed') {
        failures += 1;
        continue;
      }
      const tokens = [...cross.tokens, ...f2l.steps.flatMap((step) => step.tokens)];
      expect(isFirstTwoLayersSolved(applySequence(state, tokens))).toBe(true);
      for (const step of f2l.steps) {
        inserts.push(step.moves.length);
        for (const search of step.searches) nodes.push(search.nodes);
      }
      totals.push(f2l.steps.reduce((sum, step) => sum + step.moves.length, 0));
    }

    const p95 = percentile(
      [...solveMs].sort((a, b) => a - b),
      95,
    );
    console.log(
      [
        '',
        `solves: ${starts.length} (${count} scrambles × 6 cross faces), Node ${process.version}`,
        `table build (once): cross ${crossMs.toFixed(1)} ms (6 faces), pairs ${pairMs.toFixed(1)} ms`,
        summarise('solve ms (cross + F2L)', solveMs),
        summarise('nodes per slot search', nodes),
        summarise('chosen insert (HTM)', inserts),
        summarise('F2L total (HTM)', totals),
        `failed solves: ${failures}`,
        '',
      ].join('\n'),
    );

    expect(failures).toBe(0);
    expect(p95).toBeLessThan(BUDGET_P95_MS);
  });
});
