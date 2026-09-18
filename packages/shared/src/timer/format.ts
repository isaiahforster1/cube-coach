import { effectiveDurationMs } from './timer-machine.js';
import type { Penalty } from './types.js';

/**
 * Format a duration the way cubers read times.
 *
 * Under a minute: `12.34`. Over: `1:23.45`. Two decimal places, because that is the
 * precision competition timers display and anything more suggests accuracy the
 * measurement does not have.
 *
 * Truncated rather than rounded, matching competition convention: a 12.999 second solve
 * is a 12.99, never a 13.00. Rounding up would occasionally show someone a personal best
 * they did not achieve.
 */
export function formatDuration(milliseconds: number): string {
  const safe = Math.max(0, milliseconds);
  const totalCentiseconds = Math.floor(safe / 10);

  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);

  const fraction = centiseconds.toString().padStart(2, '0');

  return minutes === 0
    ? `${seconds}.${fraction}`
    : `${minutes}:${seconds.toString().padStart(2, '0')}.${fraction}`;
}

/**
 * Format a solve including its penalty.
 *
 * A `+2` shows the penalised time with a trailing `+`, so `12.34` recorded with a
 * penalty displays as `14.34+`. That is the competition convention: the number shown is
 * the time that counts, and the marker explains why it is not the time measured.
 */
export function formatSolve(durationMs: number, penalty: Penalty): string {
  const effective = effectiveDurationMs(durationMs, penalty);

  if (effective === null) return 'DNF';
  return penalty === 'plus2' ? `${formatDuration(effective)}+` : formatDuration(effective);
}
