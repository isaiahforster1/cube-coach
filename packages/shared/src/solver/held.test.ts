import { describe, expect, it } from 'vitest';
import { applySequence, createSolvedCube } from '../cube/cube.js';
import { FACES, type Face } from '../cube/types.js';
import { HELD_POSITIONS, heldSlotBetween, NOTATION_LETTER, type HeldPosition } from './held.js';

describe('held positions', () => {
  /** `frameOf` reads the centre of block `i` as held position `i`, so the orders must agree. */
  it('are listed in sticker-block order, each written with its own letter', () => {
    expect(HELD_POSITIONS.map((held) => NOTATION_LETTER[held])).toEqual([...FACES]);
    // Judged on a real cube: after y, the front block shows the fixed R centre.
    const front = HELD_POSITIONS.indexOf('front');
    expect(applySequence(createSolvedCube(), ['y'])[front * 9 + 4]).toBe('R');
  });

  /** The point of words over letters: a place and a colour are not interchangeable. */
  it('are a different type from Face', () => {
    const held: HeldPosition = 'front';
    // @ts-expect-error A held position is not a colour.
    const colour: Face = held;
    // @ts-expect-error A colour is not a held position.
    const place: HeldPosition = 'F' as Face;

    expect([colour, place]).toEqual(['front', 'F']);
  });
});

describe('heldSlotBetween', () => {
  it('names a slot from its two sides in either order', () => {
    expect(heldSlotBetween('front', 'right')).toBe('front-right');
    expect(heldSlotBetween('left', 'back')).toBe('back-left');
  });

  it('refuses two sides with no slot between them', () => {
    expect(() => heldSlotBetween('front', 'back')).toThrow(/No slot/);
    expect(() => heldSlotBetween('top', 'right')).toThrow(/No slot/);
  });
});
