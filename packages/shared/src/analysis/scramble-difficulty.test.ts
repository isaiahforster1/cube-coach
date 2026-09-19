import { describe, expect, it } from 'vitest';
import { parseAlgorithm } from '../cube/notation.js';
import { FACES, TURNS, type Move } from '../cube/types.js';
import { crossDifficulty } from './cross.js';
import { rateScramble, SCRAMBLE_DIFFICULTY_THRESHOLDS } from './scramble-difficulty.js';

const ALL_MOVES: Move[] = FACES.flatMap((face) => TURNS.map((turn) => `${face}${turn}` as Move));

/** A deterministic generator, so a failure can be reproduced exactly. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomScramble(random: () => number): Move[] {
  return Array.from(
    { length: 25 },
    () => ALL_MOVES[Math.floor(random() * ALL_MOVES.length)] as Move,
  );
}

describe('rateScramble', () => {
  it('calls an already-solved cross easy', () => {
    expect(rateScramble([]).difficulty).toBe('easy');
    expect(rateScramble([]).crossMoves).toBe(0);
  });

  it('reports the cross length it based the label on', () => {
    const moves = parseAlgorithm("R U R' U'");
    expect(rateScramble(moves).crossMoves).toBe(crossDifficulty(moves, 'D'));
  });

  it('reports which face it measured', () => {
    expect(rateScramble([], 'U').face).toBe('U');
    expect(rateScramble([]).face).toBe('D');
  });

  it('rates the same scramble differently on different faces when the crosses differ', () => {
    // A move that only disturbs the U cross leaves D untouched, so the two faces must
    // not agree. If they did, the face argument would be doing nothing.
    const moves = parseAlgorithm('U');
    expect(rateScramble(moves, 'D').crossMoves).toBe(0);
    expect(rateScramble(moves, 'U').crossMoves).toBe(1);
  });

  /**
   * The label must never disagree with the number it claims to be based on. This is the
   * invariant that would break first if someone "tuned" a threshold in one place only.
   */
  it('never calls a longer cross easier than a shorter one', () => {
    const random = makeRandom(20260919);
    const order = { easy: 0, standard: 1, hard: 2 };

    const rated = Array.from({ length: 300 }, () => rateScramble(randomScramble(random)));

    for (const a of rated) {
      for (const b of rated) {
        if (a.crossMoves < b.crossMoves) {
          expect(order[a.difficulty]).toBeLessThanOrEqual(order[b.difficulty]);
        }
      }
    }
  });

  it('agrees with the published thresholds', () => {
    const random = makeRandom(7);

    for (const rating of Array.from({ length: 300 }, () => rateScramble(randomScramble(random)))) {
      if (rating.crossMoves <= SCRAMBLE_DIFFICULTY_THRESHOLDS.easyAtOrBelow) {
        expect(rating.difficulty).toBe('easy');
      } else if (rating.crossMoves >= SCRAMBLE_DIFFICULTY_THRESHOLDS.hardAtOrAbove) {
        expect(rating.difficulty).toBe('hard');
      } else {
        expect(rating.difficulty).toBe('standard');
      }
    }
  });

  /**
   * The thresholds were chosen from the measured distribution, so this pins that
   * reasoning down: "standard" has to stay the common case and the other two have to
   * stay genuinely notable. If a future change made three scrambles in five "hard", the
   * word would have stopped carrying information and this fails.
   */
  it('keeps the labels meaningful across a large sample', () => {
    const random = makeRandom(99);
    const sample = Array.from({ length: 1500 }, () => rateScramble(randomScramble(random)));

    const share = (difficulty: string) =>
      sample.filter((rating) => rating.difficulty === difficulty).length / sample.length;

    expect(share('standard')).toBeGreaterThan(0.6);
    expect(share('easy')).toBeGreaterThan(0.01);
    expect(share('easy')).toBeLessThan(0.2);
    expect(share('hard')).toBeGreaterThan(0.05);
    expect(share('hard')).toBeLessThan(0.3);
  });
});
