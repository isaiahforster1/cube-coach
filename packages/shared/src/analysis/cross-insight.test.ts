import { describe, expect, it } from 'vitest';
import { analyseCrossDifficulty, type ScrambledSolve } from './cross-insight.js';
import { crossDifficulty } from './cross.js';
import { parseAlgorithm } from '../cube/notation.js';

/**
 * Two scrambles with known, very different D-cross difficulty, verified here rather than
 * assumed — if the solver changed, these fixtures would quietly stop testing anything.
 */
const EASY_SCRAMBLE = 'U2 F2 U';
const HARD_SCRAMBLE = "D2 R U2 F' L B2 R' D F2 U";

function solve(
  scramble: string,
  seconds: number,
  penalty: 'none' | 'plus2' | 'dnf' = 'none',
): ScrambledSolve {
  return { scramble, durationMs: seconds * 1000, penalty };
}

describe('the fixtures really do differ in difficulty', () => {
  it('has an easy scramble at or below the threshold', () => {
    expect(crossDifficulty(parseAlgorithm(EASY_SCRAMBLE), 'D')).toBeLessThanOrEqual(5);
  });

  it('has a hard scramble above the threshold', () => {
    expect(crossDifficulty(parseAlgorithm(HARD_SCRAMBLE), 'D')).toBeGreaterThan(5);
  });
});

describe('analyseCrossDifficulty', () => {
  function history(easySeconds: number[], hardSeconds: number[]): ScrambledSolve[] {
    return [
      ...easySeconds.map((seconds) => solve(EASY_SCRAMBLE, seconds)),
      ...hardSeconds.map((seconds) => solve(HARD_SCRAMBLE, seconds)),
    ];
  }

  const eight = (value: number) => Array.from({ length: 8 }, () => value);

  it('reports nothing without enough solves to be sure', () => {
    expect(analyseCrossDifficulty(history([12, 12], [18, 18]))).toBeNull();
  });

  it('refuses when only one of the two groups has enough solves', () => {
    expect(analyseCrossDifficulty(history(eight(12), [18, 18]))).toBeNull();
  });

  it('measures how much slower the hard crosses are', () => {
    const insight = analyseCrossDifficulty(history(eight(12), eight(18)));

    expect(insight).not.toBeNull();
    expect(insight?.easyMeanMs).toBe(12_000);
    expect(insight?.hardMeanMs).toBe(18_000);
    expect(insight?.differenceMs).toBe(6_000);
    expect(insight?.easyCount).toBe(8);
    expect(insight?.hardCount).toBe(8);
  });

  it('reports a small difference for a cuber who plans the cross either way', () => {
    const insight = analyseCrossDifficulty(history(eight(12), eight(12.5)));
    expect(insight?.differenceMs).toBe(500);
  });

  it('counts a +2 at its penalised time', () => {
    const solves: ScrambledSolve[] = [
      ...Array.from({ length: 8 }, () => solve(EASY_SCRAMBLE, 10, 'plus2')),
      ...eight(20).map((seconds) => solve(HARD_SCRAMBLE, seconds)),
    ];

    expect(analyseCrossDifficulty(solves)?.easyMeanMs).toBe(12_000);
  });

  it('leaves DNFs out of the means entirely', () => {
    const solves: ScrambledSolve[] = [
      ...eight(12).map((seconds) => solve(EASY_SCRAMBLE, seconds)),
      solve(EASY_SCRAMBLE, 99, 'dnf'),
      ...eight(18).map((seconds) => solve(HARD_SCRAMBLE, seconds)),
    ];

    const insight = analyseCrossDifficulty(solves);
    expect(insight?.easyMeanMs).toBe(12_000);
    expect(insight?.easyCount).toBe(8);
  });

  /**
   * A scramble in a notation the engine does not implement — imported from elsewhere,
   * say — must not take the whole summary down with it.
   */
  it('skips a scramble it cannot parse rather than failing', () => {
    const solves: ScrambledSolve[] = [
      { scramble: 'Rw2 Fw', durationMs: 10_000, penalty: 'none' },
      ...eight(12).map((seconds) => solve(EASY_SCRAMBLE, seconds)),
      ...eight(18).map((seconds) => solve(HARD_SCRAMBLE, seconds)),
    ];

    expect(analyseCrossDifficulty(solves)?.easyCount).toBe(8);
  });
});
