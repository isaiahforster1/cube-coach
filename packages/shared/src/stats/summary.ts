import {
  analyseCrossDifficulty,
  type CrossDifficultyInsight,
  type ScrambledSolve,
} from '../analysis/cross-insight.js';
import { effectiveDurationMs } from '../timer/timer-machine.js';
import { averageOf, bestAverageOf } from './averages.js';
import { summariseConsistency } from './consistency.js';
import type { AverageResult, ConsistencySummary } from './types.js';

/** The average sizes worth showing. 5 and 12 are the competition ones; the rest are habit. */
export const AVERAGE_SIZES = [5, 12, 50, 100] as const;

export type AverageSize = (typeof AVERAGE_SIZES)[number];

export interface AveragePair {
  readonly current: AverageResult;
  readonly best: AverageResult;
}

export interface StatsSummary {
  readonly consistency: ConsistencySummary;
  readonly averages: Record<`ao${AverageSize}`, AveragePair>;
  /** The single best solve, which is the personal record cubers quote. */
  readonly bestSingleMs: number | null;
  readonly crossInsight: CrossDifficultyInsight | null;
}

/**
 * Everything the statistics screen needs, computed in one pass.
 *
 * Deliberately a pure function in the shared package rather than logic in the API. The
 * server computes it authoritatively, and the client can compute the same thing from
 * solves it already has in order to update instantly after a solve — from the same code,
 * so the two cannot disagree. A statistics product that reports different numbers in two
 * places has lost the only thing it sells.
 *
 * `solves` must be oldest first, because the averages are windows over recent history.
 */
export function buildStatsSummary(solves: readonly ScrambledSolve[]): StatsSummary {
  const consistency = summariseConsistency(solves);

  const averages = Object.fromEntries(
    AVERAGE_SIZES.map((size) => [
      `ao${size}`,
      { current: averageOf(solves, size), best: bestAverageOf(solves, size) },
    ]),
  ) as Record<`ao${AverageSize}`, AveragePair>;

  const finished = solves
    .map((solve) => effectiveDurationMs(solve.durationMs, solve.penalty))
    .filter((value): value is number => value !== null);

  return {
    consistency,
    averages,
    bestSingleMs: finished.length === 0 ? null : Math.min(...finished),
    crossInsight: analyseCrossDifficulty(solves),
  };
}
