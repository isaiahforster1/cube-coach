import {
  analyseCrossDifficulty,
  type CrossDifficultyInsight,
  type ScrambledSolve,
} from '../analysis/cross-insight.js';
import { averageOf, bestAverageOf } from './averages.js';
import { summariseConsistency } from './consistency.js';
import type { AverageResult, ConsistencySummary } from './types.js';

/** The average sizes worth showing. 5 and 12 are the competition ones; the rest are habit. */
export const AVERAGE_SIZES = [5, 12, 50, 100] as const;

export type AverageSize = (typeof AVERAGE_SIZES)[number];

/**
 * The cross insight looks at the most recent solves only, and this is a product decision
 * as much as a performance one.
 *
 * The question it answers is "do you currently give up planning the cross when it is
 * hard?" — a habit, and habits change. Two years and forty thousand solves ago says
 * little about today, and averaging it in would bury a change the cuber has made.
 *
 * It is also the one statistic that runs the cube engine on every scramble, around 50
 * microseconds each at the longest scramble the API accepts. Unbounded, a large history
 * blocked the event loop for seconds on every request; a thousand solves costs about 50ms
 * at worst, and is still far above the minimum evidence the analysis requires.
 */
export const CROSS_ANALYSIS_WINDOW = 1000;

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

  return {
    consistency,
    averages,
    // The best single is the fastest counting solve, which the consistency summary has
    // already found.
    bestSingleMs: consistency.bestMs,
    crossInsight: analyseCrossDifficulty(solves.slice(-CROSS_ANALYSIS_WINDOW)),
  };
}
