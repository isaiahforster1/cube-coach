import { describe, expect, it } from 'vitest';
import { solverStepsQuerySchema } from './solver.js';

describe('solverStepsQuerySchema', () => {
  it('parses the scramble into moves and defaults the cross to D', () => {
    expect(solverStepsQuerySchema.parse({ scramble: 'R U’ F2' })).toEqual({
      scramble: ['R', "U'", 'F2'],
      crossFace: 'D',
    });
  });

  it.each([
    ['a rotation', 'R y U'],
    ['a wide turn', 'R r U'],
    ['a typo', 'R Q'],
  ])('refuses %s, because solver state must keep its centres home', (_, scramble) => {
    const result = solverStepsQuerySchema.safeParse({ scramble });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/^Invalid move/u);
  });

  it('refuses an empty scramble with a message a person can act on', () => {
    const result = solverStepsQuerySchema.safeParse({ scramble: '   ' });
    expect(result.error?.issues[0]?.message).toBe('Enter a scramble');
  });

  it('refuses a cross face that is not a face', () => {
    expect(solverStepsQuerySchema.safeParse({ scramble: 'R', crossFace: 'x' }).success).toBe(false);
  });
});
