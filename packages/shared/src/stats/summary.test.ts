import { describe, expect, it } from 'vitest';
import { buildStatsSummary, CROSS_ANALYSIS_WINDOW } from './summary.js';
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

  /**
   * `Math.min(...values)` passes every element as a separate argument, and arguments
   * live on the call stack, so a long enough history overflowed it. A stored history is
   * attacker-controlled in size, which made that a way to break the stats endpoint.
   */
  it('handles a history far larger than the call stack', () => {
    // An unparseable scramble keeps the cross analysis cheap; the averages are the point.
    const solves: ScrambledSolve[] = Array.from({ length: 200_000 }, (_, index) => ({
      scramble: 'not a scramble',
      durationMs: 10_000 + (index % 5_000),
      penalty: 'none',
    }));

    const summary = buildStatsSummary(solves);

    expect(summary.bestSingleMs).toBe(10_000);
    expect(summary.consistency.worstMs).toBe(14_999);
  });

  /**
   * The cross analysis solves every scramble with the cube engine, so it is the one part
   * whose cost grows fastest with history. It looks at recent solves only, which is also
   * the better answer: the question is how someone practises now.
   */
  it('bases the cross insight on recent solves only', () => {
    const hard = (seconds: number): ScrambledSolve => ({
      scramble: "D2 R U2 F' L B2 R' D F2 U",
      durationMs: seconds * 1000,
      penalty: 'none',
    });
    const easy = (seconds: number): ScrambledSolve => ({
      scramble: 'U2 F2 U',
      durationMs: seconds * 1000,
      penalty: 'none',
    });

    const old = Array.from({ length: 50 }, () => hard(30));
    const recent = [
      ...Array.from({ length: 8 }, () => hard(14)),
      ...Array.from({ length: CROSS_ANALYSIS_WINDOW - 8 }, () => easy(12)),
    ];

    const insight = buildStatsSummary([...old, ...recent]).crossInsight;

    expect(insight?.hardCount).toBe(8);
    expect(insight?.hardMeanMs).toBe(14_000);
    expect(CROSS_ANALYSIS_WINDOW).toBe(1000);
  });
});
