import type { Penalty } from '../timer/types.js';

/** The minimum a solve must provide to be counted in statistics. */
export interface SolveLike {
  readonly durationMs: number;
  readonly penalty: Penalty;
}

/**
 * The outcome of an average, as three distinct cases rather than a nullable number.
 *
 * "Did not finish" and "not enough solves yet" are different facts, and a caller must
 * render them differently — `DNF` versus `—`. Collapsing both into null loses that, and
 * returning a sentinel number invites the value into arithmetic where it does not belong.
 */
export type AverageResult =
  | { readonly kind: 'average'; readonly milliseconds: number }
  | { readonly kind: 'dnf' }
  | { readonly kind: 'not-enough-solves'; readonly needed: number };

export interface ConsistencySummary {
  /** Mean of all counting solves. DNFs are excluded rather than treated as a time. */
  readonly meanMs: number | null;
  readonly bestMs: number | null;
  readonly worstMs: number | null;
  /** Worst minus best: how wide the spread is in absolute terms. */
  readonly spreadMs: number | null;
  readonly standardDeviationMs: number | null;
  /**
   * Standard deviation as a fraction of the mean.
   *
   * The useful form for comparing cubers of different speeds: a 2-second deviation is
   * disastrous at a 10-second average and unremarkable at 60.
   */
  readonly relativeDeviation: number | null;
  readonly solveCount: number;
  readonly dnfCount: number;
}
