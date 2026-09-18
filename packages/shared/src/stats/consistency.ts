import { effectiveDurationMs } from '../timer/timer-machine.js';
import type { ConsistencySummary, SolveLike } from './types.js';

/**
 * The spread of a set of solves, which is where diagnosis starts.
 *
 * An average tells you how fast someone is. It says nothing about *why* they are at that
 * speed, and two cubers with an identical average can need completely different advice:
 * one whose solves are all within a second of each other is limited by technique and
 * needs faster methods; one alternating between very fast and very slow is limited by
 * consistency and needs to stop making mistakes. Only the spread distinguishes them.
 *
 * DNFs are excluded rather than counted as a time, because they have no duration. They
 * are reported separately — a rising DNF count is itself a signal.
 */
export function summariseConsistency(solves: readonly SolveLike[]): ConsistencySummary {
  const times = solves
    .map((solve) => effectiveDurationMs(solve.durationMs, solve.penalty))
    .filter((value): value is number => value !== null);

  const dnfCount = solves.length - times.length;

  if (times.length === 0) {
    return {
      meanMs: null,
      bestMs: null,
      worstMs: null,
      spreadMs: null,
      standardDeviationMs: null,
      relativeDeviation: null,
      solveCount: solves.length,
      dnfCount,
    };
  }

  const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
  const best = Math.min(...times);
  const worst = Math.max(...times);

  /**
   * Population standard deviation, not the sample estimate.
   *
   * These solves are not a sample drawn from a population — they are the whole history,
   * every solve there is. Dividing by n-1 corrects for sampling that has not happened.
   */
  const variance = times.reduce((sum, value) => sum + (value - mean) ** 2, 0) / times.length;
  const standardDeviation = Math.sqrt(variance);

  return {
    meanMs: Math.round(mean),
    bestMs: best,
    worstMs: worst,
    spreadMs: worst - best,
    standardDeviationMs: Math.round(standardDeviation),
    relativeDeviation: mean === 0 ? null : standardDeviation / mean,
    solveCount: solves.length,
    dnfCount,
  };
}
