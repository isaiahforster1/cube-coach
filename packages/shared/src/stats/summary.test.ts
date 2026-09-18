import { describe, expect, it } from 'vitest';
import { buildStatsSummary } from './summary.js';
import type { ScrambledSolve } from '../analysis/cross-insight.js';

function history(...seconds: number[]): ScrambledSolve[] {
  return seconds.map((value) => ({
    scramble: 'U2 F2 U',
    durationMs: value * 1000,
    penalty: 'none',
  }));
}

describe('buildStatsSummary', () => {
  it('handles an empty history without inventing numbers', () => {
    const summary = buildStatsSummary([]);

    expect(summary.bestSingleMs).toBeNull();
    expect(summary.consistency.meanMs).toBeNull();
    expect(summary.averages.ao5.current).toEqual({ kind: 'not-enough-solves', needed: 5 });
    expect(summary.crossInsight).toBeNull();
  });

  it('reports the best single', () => {
    expect(buildStatsSummary(history(14, 11, 16)).bestSingleMs).toBe(11_000);
  });

  it('computes current and best averages of five', () => {
    // Oldest first: the fast run is at the start, the current window at the end.
    const summary = buildStatsSummary(history(10, 11, 12, 13, 14, 20, 21, 22, 23, 24));

    expect(summary.averages.ao5.current).toEqual({ kind: 'average', milliseconds: 22_000 });
    expect(summary.averages.ao5.best).toEqual({ kind: 'average', milliseconds: 12_000 });
  });

  it('says so rather than guessing when a longer average is not yet possible', () => {
    const summary = buildStatsSummary(history(10, 11, 12, 13, 14));

    expect(summary.averages.ao5.current.kind).toBe('average');
    expect(summary.averages.ao12.current).toEqual({ kind: 'not-enough-solves', needed: 12 });
    expect(summary.averages.ao100.current).toEqual({ kind: 'not-enough-solves', needed: 100 });
  });

  it('withholds the cross insight until there is enough evidence', () => {
    expect(buildStatsSummary(history(12, 13, 14)).crossInsight).toBeNull();
  });
});
