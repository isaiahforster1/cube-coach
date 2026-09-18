import { describe, expect, it } from 'vitest';
import { averageOf, bestAverageOf, trimCount } from './averages.js';
import type { SolveLike } from './types.js';
import type { Penalty } from '../timer/types.js';

/** Build solves from plain seconds, oldest first. */
function solves(...entries: (number | [number, Penalty])[]): SolveLike[] {
  return entries.map((entry) =>
    typeof entry === 'number'
      ? { durationMs: entry * 1000, penalty: 'none' }
      : { durationMs: entry[0] * 1000, penalty: entry[1] },
  );
}

describe('trimCount', () => {
  // 5 and 12 must match the WCA regulation exactly; the rest follow the 5% convention.
  it.each([
    [5, 1],
    [12, 1],
    [50, 3],
    [100, 5],
  ])('trims %i solves down by %i from each end', (size, expected) => {
    expect(trimCount(size)).toBe(expected);
  });
});

describe('averageOf', () => {
  it('drops the best and worst, then means the rest', () => {
    // 10 and 30 are trimmed, leaving 15, 20, 25 → 20.
    const result = averageOf(solves(10, 15, 20, 25, 30), 5);
    expect(result).toEqual({ kind: 'average', milliseconds: 20_000 });
  });

  it('uses only the most recent window', () => {
    // The leading 99s are outside the window of 5 and must not affect it.
    const result = averageOf(solves(99, 99, 10, 15, 20, 25, 30), 5);
    expect(result).toEqual({ kind: 'average', milliseconds: 20_000 });
  });

  it('reports when there are not enough solves yet', () => {
    expect(averageOf(solves(10, 12, 14), 5)).toEqual({ kind: 'not-enough-solves', needed: 5 });
  });

  it('counts a +2 at its penalised time', () => {
    // 12+2 = 14 becomes the worst and is trimmed; 11, 12, 13 remain → 12.
    const result = averageOf(solves(10, 11, 12, 13, [12, 'plus2']), 5);
    expect(result).toEqual({ kind: 'average', milliseconds: 12_000 });
  });

  it('lets a +2 change which solves are trimmed, and so the result', () => {
    // Without the penalty 10 is the fastest and gets trimmed, leaving 11, 13, 15.
    const withoutPenalty = averageOf(solves(10, 11, 13, 15, 17), 5);
    expect(withoutPenalty).toEqual({ kind: 'average', milliseconds: 13_000 });

    // With it, 10 becomes 12 and is no longer the fastest — 11 is trimmed instead, and
    // the counting solves become 12, 13, 15.
    const withPenalty = averageOf(solves([10, 'plus2'], 11, 13, 15, 17), 5);
    expect(withPenalty).toEqual({ kind: 'average', milliseconds: 13_333 });
  });
});

/**
 * The rules people get wrong. A DNF is not skipped and not zero — it ranks worse than
 * any time, so exactly one of them is trimmed away as the worst solve and the average
 * still counts. A second one survives the trim and takes the whole average with it.
 */
describe('averageOf with DNFs', () => {
  it('trims a single DNF as the worst solve, leaving a valid average', () => {
    const result = averageOf(solves(10, 15, 20, 25, [30, 'dnf']), 5);
    expect(result).toEqual({ kind: 'average', milliseconds: 20_000 });
  });

  it('is a DNF once two solves did not finish', () => {
    expect(averageOf(solves(10, 15, 20, [25, 'dnf'], [30, 'dnf']), 5)).toEqual({ kind: 'dnf' });
  });

  it('ignores the recorded duration of a DNF entirely', () => {
    // The DNF is stored as 1 second, which would drag the average down if it were
    // treated as a time. It must rank as the worst solve regardless.
    const result = averageOf(solves(10, 15, 20, 25, [1, 'dnf']), 5);
    expect(result).toEqual({ kind: 'average', milliseconds: 20_000 });
  });

  it('survives one DNF in an average of twelve', () => {
    const result = averageOf(solves(10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, [99, 'dnf']), 12);
    // 10 and the DNF are trimmed, leaving 11 through 20 → 15.5.
    expect(result).toEqual({ kind: 'average', milliseconds: 15_500 });
  });

  it('is a DNF with two DNFs in an average of twelve', () => {
    const result = averageOf(
      solves(10, 11, 12, 13, 14, 15, 16, 17, 18, 19, [98, 'dnf'], [99, 'dnf']),
      12,
    );
    expect(result).toEqual({ kind: 'dnf' });
  });

  it('tolerates three DNFs in an average of fifty, which trims three each side', () => {
    const many = solves(...Array.from({ length: 47 }, (_, index) => 10 + index * 0.1));
    const withDnfs: SolveLike[] = [
      ...many,
      { durationMs: 20_000, penalty: 'dnf' },
      { durationMs: 20_000, penalty: 'dnf' },
      { durationMs: 20_000, penalty: 'dnf' },
    ];

    expect(averageOf(withDnfs, 50).kind).toBe('average');
  });

  it('is a DNF with four DNFs in an average of fifty', () => {
    const many = solves(...Array.from({ length: 46 }, (_, index) => 10 + index * 0.1));
    const withDnfs: SolveLike[] = [
      ...many,
      ...Array.from({ length: 4 }, () => ({ durationMs: 20_000, penalty: 'dnf' as const })),
    ];

    expect(averageOf(withDnfs, 50)).toEqual({ kind: 'dnf' });
  });
});

describe('bestAverageOf', () => {
  /** A best average must be consecutive solves, not the best ones cherry-picked. */
  it('finds the best consecutive window', () => {
    // The fast run sits in the middle: 10, 11, 12, 13, 14 → trims to 11, 12, 13 → 12.
    const result = bestAverageOf(solves(30, 30, 10, 11, 12, 13, 14, 30, 30), 5);
    expect(result).toEqual({ kind: 'average', milliseconds: 12_000 });
  });

  it('is not simply the five fastest solves', () => {
    // The five fastest are 10, 11, 12, 13, 14 but they are not consecutive, so the best
    // real window is worse than the average of those.
    const result = bestAverageOf(solves(10, 30, 11, 30, 12, 30, 13, 30, 14), 5);
    expect(result.kind).toBe('average');
    if (result.kind === 'average') {
      expect(result.milliseconds).toBeGreaterThan(14_000);
    }
  });

  it('skips windows that are DNFs and keeps the best valid one', () => {
    const result = bestAverageOf(solves([1, 'dnf'], [1, 'dnf'], 20, 20, 20, 10, 11, 12, 13, 14), 5);
    expect(result).toEqual({ kind: 'average', milliseconds: 12_000 });
  });

  it('is a DNF when no window produces a number', () => {
    const allDnf = Array.from({ length: 6 }, () => ({
      durationMs: 10_000,
      penalty: 'dnf' as const,
    }));
    expect(bestAverageOf(allDnf, 5)).toEqual({ kind: 'dnf' });
  });

  it('reports when the history is too short', () => {
    expect(bestAverageOf(solves(10, 11), 5)).toEqual({ kind: 'not-enough-solves', needed: 5 });
  });
});
