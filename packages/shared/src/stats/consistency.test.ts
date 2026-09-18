import { describe, expect, it } from 'vitest';
import { summariseConsistency } from './consistency.js';
import type { SolveLike } from './types.js';
import type { Penalty } from '../timer/types.js';

function solves(...entries: (number | [number, Penalty])[]): SolveLike[] {
  return entries.map((entry) =>
    typeof entry === 'number'
      ? { durationMs: entry * 1000, penalty: 'none' }
      : { durationMs: entry[0] * 1000, penalty: entry[1] },
  );
}

describe('summariseConsistency', () => {
  it('reports nothing meaningful for an empty history', () => {
    const summary = summariseConsistency([]);

    expect(summary.meanMs).toBeNull();
    expect(summary.standardDeviationMs).toBeNull();
    expect(summary.solveCount).toBe(0);
  });

  it('computes mean, best, worst and spread', () => {
    const summary = summariseConsistency(solves(10, 14, 18));

    expect(summary.meanMs).toBe(14_000);
    expect(summary.bestMs).toBe(10_000);
    expect(summary.worstMs).toBe(18_000);
    expect(summary.spreadMs).toBe(8_000);
  });

  it('includes the penalty in the time that counts', () => {
    // 10+2 = 12, so the mean of 12 and 14 is 13.
    const summary = summariseConsistency(solves([10, 'plus2'], 14));
    expect(summary.meanMs).toBe(13_000);
  });

  it('excludes DNFs from the times but counts them separately', () => {
    const summary = summariseConsistency(solves(10, 14, [99, 'dnf']));

    expect(summary.meanMs).toBe(12_000);
    expect(summary.worstMs).toBe(14_000);
    expect(summary.solveCount).toBe(3);
    expect(summary.dnfCount).toBe(1);
  });

  it('has no deviation when every solve is identical', () => {
    const summary = summariseConsistency(solves(12, 12, 12, 12));

    expect(summary.standardDeviationMs).toBe(0);
    expect(summary.relativeDeviation).toBe(0);
  });

  it('computes the population standard deviation', () => {
    // 10, 20, 30: mean 20, deviations -10/0/+10, variance 200/3, sd ≈ 8.165s.
    const summary = summariseConsistency(solves(10, 20, 30));
    expect(summary.standardDeviationMs).toBe(8_165);
  });

  /**
   * The metric that makes cubers comparable. Two seconds of deviation is a catastrophe at
   * a ten-second average and unremarkable at sixty, so the useful figure is deviation as
   * a fraction of the mean.
   */
  it('expresses deviation relative to the mean', () => {
    const fast = summariseConsistency(solves(9, 10, 11));
    const slow = summariseConsistency(solves(59, 60, 61));

    expect(fast.standardDeviationMs).toBe(slow.standardDeviationMs);
    // Identical absolute spread, very different meaning.
    expect(fast.relativeDeviation).toBeGreaterThan((slow.relativeDeviation ?? 0) * 5);
  });

  it('distinguishes a steady cuber from an erratic one with the same average', () => {
    const steady = summariseConsistency(solves(15, 15, 15, 15, 15));
    const erratic = summariseConsistency(solves(11, 19, 12, 18, 15));

    // Same average, completely different advice: one needs faster technique, the other
    // needs to stop making mistakes.
    expect(steady.meanMs).toBe(erratic.meanMs);
    expect(erratic.standardDeviationMs).toBeGreaterThan(steady.standardDeviationMs ?? 0);
    expect(erratic.spreadMs).toBeGreaterThan(steady.spreadMs ?? 0);
  });

  it('reports only DNFs when nothing finished', () => {
    const summary = summariseConsistency(solves([10, 'dnf'], [11, 'dnf']));

    expect(summary.meanMs).toBeNull();
    expect(summary.dnfCount).toBe(2);
    expect(summary.solveCount).toBe(2);
  });
});
