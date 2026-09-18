import { describe, expect, it } from 'vitest';
import { formatDuration, formatSolve } from './format.js';

describe('formatDuration', () => {
  it.each([
    [0, '0.00'],
    [90, '0.09'],
    [1_000, '1.00'],
    [12_340, '12.34'],
    [59_990, '59.99'],
    [60_000, '1:00.00'],
    [83_450, '1:23.45'],
    [3_600_000, '60:00.00'],
  ])('formats %ims as %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  /**
   * Truncated, not rounded. Competition convention, and rounding up would occasionally
   * show someone a personal best they did not actually achieve.
   */
  it('truncates rather than rounding', () => {
    expect(formatDuration(12_999)).toBe('12.99');
    expect(formatDuration(9_998)).toBe('9.99');
  });

  it('never shows a negative time', () => {
    expect(formatDuration(-500)).toBe('0.00');
  });
});

describe('formatSolve', () => {
  it('shows a clean time as-is', () => {
    expect(formatSolve(12_340, 'none')).toBe('12.34');
  });

  // The number shown is the time that counts; the marker explains why it differs from
  // the time measured.
  it('shows the penalised time with a marker for a +2', () => {
    expect(formatSolve(12_340, 'plus2')).toBe('14.34+');
  });

  it('shows DNF rather than a number', () => {
    expect(formatSolve(12_340, 'dnf')).toBe('DNF');
  });

  it('carries a +2 across the minute boundary', () => {
    expect(formatSolve(58_500, 'plus2')).toBe('1:00.50+');
  });
});
