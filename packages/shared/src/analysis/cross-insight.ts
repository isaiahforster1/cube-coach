import { parseAlgorithm } from '../cube/notation.js';
import { effectiveDurationMs } from '../timer/timer-machine.js';
import type { Penalty } from '../timer/types.js';
import type { Face } from '../cube/types.js';
import { crossDifficulty } from './cross.js';

export interface ScrambledSolve {
  readonly scramble: string;
  readonly durationMs: number;
  readonly penalty: Penalty;
}

export interface CrossDifficultyInsight {
  /** Mean time on scrambles whose cross is short. */
  readonly easyMeanMs: number;
  /** Mean time on scrambles whose cross is long. */
  readonly hardMeanMs: number;
  /** How much slower the hard ones are. The number the advice hangs on. */
  readonly differenceMs: number;
  readonly easyCount: number;
  readonly hardCount: number;
  /** Moves at or below this count counted as easy. */
  readonly threshold: number;
}

/** A cross of five moves or fewer is comfortably plannable during inspection. */
const EASY_THRESHOLD = 5;

/**
 * Refuse to report on fewer than this many solves in either group.
 *
 * With a handful of solves the difference between the groups is noise, and presenting
 * noise as a finding is worse than saying nothing: a cuber who changes their practice
 * because of a fluke has been actively harmed by the tool.
 */
const MINIMUM_PER_GROUP = 8;

/**
 * Does this cuber slow down when the cross is hard?
 *
 * Everyone is somewhat slower on a harder scramble — the solve genuinely contains more
 * moves. What matters is *how much*. A small gap means the cross is being planned during
 * inspection regardless of difficulty. A large gap means inspection is being spent on
 * easy crosses and abandoned on hard ones, and the advice that follows is specific and
 * actionable: practise planning the cross on deliberately awkward scrambles.
 *
 * This is the thing a timer cannot tell you from times alone, and it is computable only
 * because the scramble is stored and the engine can solve the cross exactly.
 *
 * Returns null when there is not enough evidence, rather than a weak claim.
 */
export function analyseCrossDifficulty(
  solves: readonly ScrambledSolve[],
  face: Face = 'D',
): CrossDifficultyInsight | null {
  const easy: number[] = [];
  const hard: number[] = [];

  for (const solve of solves) {
    const time = effectiveDurationMs(solve.durationMs, solve.penalty);
    // A DNF has no duration, so it cannot contribute to a mean.
    if (time === null) continue;

    let moves;
    try {
      moves = parseAlgorithm(solve.scramble);
    } catch {
      // A scramble that predates this analysis, or came from elsewhere in a notation the
      // engine does not implement. Skip it rather than failing the whole summary.
      continue;
    }

    (crossDifficulty(moves, face) <= EASY_THRESHOLD ? easy : hard).push(time);
  }

  if (easy.length < MINIMUM_PER_GROUP || hard.length < MINIMUM_PER_GROUP) {
    return null;
  }

  const mean = (values: number[]) =>
    Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);

  const easyMeanMs = mean(easy);
  const hardMeanMs = mean(hard);

  return {
    easyMeanMs,
    hardMeanMs,
    differenceMs: hardMeanMs - easyMeanMs,
    easyCount: easy.length,
    hardCount: hard.length,
    threshold: EASY_THRESHOLD,
  };
}
