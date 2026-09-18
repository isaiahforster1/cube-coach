import { effectiveDurationMs } from '../timer/timer-machine.js';
import type { AverageResult, SolveLike } from './types.js';

/**
 * How many solves are trimmed from each end of an average.
 *
 * The WCA defines averages of 5 and 12 as trimming the single best and single worst.
 * Larger averages are a community convention rather than a regulation: 5% from each end,
 * rounded up, which gives 1 for an ao5 and ao12 (matching the regulation), 3 for an ao50
 * and 5 for an ao100.
 */
export function trimCount(sampleSize: number): number {
  return Math.max(1, Math.ceil(sampleSize * 0.05));
}

/**
 * A trimmed mean over the most recent `count` solves, following competition rules.
 *
 * The rule that catches people out is how a DNF behaves. It is not skipped and it is not
 * zero — it ranks as **worse than any time**. So in an average of five, a single DNF is
 * trimmed away as the worst solve and the average is perfectly valid. A second DNF
 * survives the trim, and because it has no duration the whole average becomes a DNF.
 *
 * That falls out naturally here: DNFs sort last, the trim removes the same number from
 * each end regardless, and any DNF still standing afterwards makes the result a DNF.
 */
export function averageOf(solves: readonly SolveLike[], count: number): AverageResult {
  if (count < 3) {
    throw new RangeError(`An average needs at least 3 solves, received ${count}`);
  }

  if (solves.length < count) {
    return { kind: 'not-enough-solves', needed: count };
  }

  // Most recent `count` solves. The list is oldest-first, so the window is at the end.
  const window = solves.slice(-count);

  // null represents a DNF and must sort after every real time.
  const sorted = window
    .map((solve) => effectiveDurationMs(solve.durationMs, solve.penalty))
    .sort((a, b) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    });

  const trim = trimCount(count);
  const counting = sorted.slice(trim, sorted.length - trim);

  if (counting.some((value) => value === null)) {
    return { kind: 'dnf' };
  }

  const total = counting.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return { kind: 'average', milliseconds: Math.round(total / counting.length) };
}

/**
 * The best average of `count` across every window in the history.
 *
 * A personal best average is not the best solves cherry-picked from the whole session —
 * it must be `count` *consecutive* solves. That is what makes it meaningful: it measures
 * sustained performance rather than a lucky scatter.
 */
export function bestAverageOf(solves: readonly SolveLike[], count: number): AverageResult {
  if (solves.length < count) {
    return { kind: 'not-enough-solves', needed: count };
  }

  let best: number | null = null;

  for (let end = count; end <= solves.length; end += 1) {
    const result = averageOf(solves.slice(end - count, end), count);
    if (result.kind === 'average' && (best === null || result.milliseconds < best)) {
      best = result.milliseconds;
    }
  }

  // Every window contained too many DNFs to produce a number.
  return best === null ? { kind: 'dnf' } : { kind: 'average', milliseconds: best };
}

/** The current average, i.e. the most recent window. Sugar for readability at call sites. */
export function currentAverageOf(solves: readonly SolveLike[], count: number): AverageResult {
  return averageOf(solves, count);
}
