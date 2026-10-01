import { describe, expect, it } from 'vitest';
import { applySequence, createSolvedCube } from '../cube/cube.js';
import { parseSequence } from '../cube/notation.js';
import type { Face } from '../cube/types.js';
import { HELD_SLOTS } from './held.js';
import { isCrossSolved, isFirstTwoLayersSolved, isPairSolved, PAIR_STICKERS } from './oracle.js';

const after = (sequence: string) => applySequence(createSolvedCube(), parseSequence(sequence));

describe('isCrossSolved', () => {
  it('accepts a solved cube', () => {
    expect(isCrossSolved(createSolvedCube())).toBe(true);
  });

  it('ignores everything above the cross', () => {
    expect(isCrossSolved(after('U2'))).toBe(true);
    // Takes a corner and an edge out of the first two layers, but every cross edge comes home.
    expect(isCrossSolved(after("R U R'"))).toBe(true);
  });

  it('rejects a turned bottom layer and a disturbed cross edge', () => {
    expect(isCrossSolved(after('D'))).toBe(false);
    expect(isCrossSolved(after('R'))).toBe(false);
  });

  /** Judged against centres, so how the cube is held around the vertical axis is irrelevant. */
  it('accepts a solved cross after a y rotation, and after z2 puts the U cross on the bottom', () => {
    expect(isCrossSolved(after('y'))).toBe(true);
    expect(isCrossSolved(after('z2'))).toBe(true);
  });

  /**
   * A solved cube has all six crosses solved, so rotating one proves nothing. `U` leaves
   * only the D cross (and the U cross) intact; after `x` the broken B cross is underneath.
   */
  it('rejects a solved cross that is no longer on the bottom', () => {
    expect(isCrossSolved(after('U'))).toBe(true);
    expect(isCrossSolved(after('U x'))).toBe(false);
  });

  /** A plus sign of the right colour is not a cross if the side colours do not match. */
  it('rejects two bottom edges swapped', () => {
    const swapped: Face[] = [...createSolvedCube()];
    // DF's side sticker is 25 and DR's is 16. Swapping them swaps the two edges' pieces.
    [swapped[25], swapped[16]] = ['R', 'F'];

    expect(isCrossSolved(swapped)).toBe(false);
  });
});

describe('isPairSolved and isFirstTwoLayersSolved', () => {
  it('accept a solved cube, however it is turned about the vertical axis', () => {
    for (const grip of ['', 'y', 'y2', "y'"]) {
      const state = after(grip);
      expect(HELD_SLOTS.every((slot) => isPairSolved(state, slot))).toBe(true);
      expect(isFirstTwoLayersSolved(state)).toBe(true);
    }
  });

  /** Guards the hand-entered facelets: each must lie on the face of the centre it is checked against. */
  it('check each sticker against the centre of its own face', () => {
    for (const slot of HELD_SLOTS) {
      for (const [facelet, centre] of PAIR_STICKERS[slot]) {
        expect(Math.floor(facelet / 9)).toBe(Math.floor(centre / 9));
      }
    }
  });

  it("see R U R' break front right and nothing else", () => {
    const state = after("R U R'");

    expect(isPairSolved(state, 'front-right')).toBe(false);
    for (const slot of ['front-left', 'back-right', 'back-left'] as const) {
      expect(isPairSolved(state, slot)).toBe(true);
    }
    expect(isFirstTwoLayersSolved(state)).toBe(false);
  });

  it('judge as held: after y, the same insert breaks a different pair', () => {
    // After y the fixed BR pair is at held front right, so the insert breaks that pair.
    const state = after("y R U R' y'");

    expect(isPairSolved(state, 'front-right')).toBe(true);
    expect(isPairSolved(state, 'back-right')).toBe(false);
  });

  it('reject a corner twisted in place', () => {
    const twisted: Face[] = [...createSolvedCube()];
    // DFR's three stickers, turned one step: D on F's position, F on R's, R on D's.
    [twisted[29], twisted[26], twisted[15]] = ['R', 'D', 'F'];

    expect(isPairSolved(twisted, 'front-right')).toBe(false);
    expect(isCrossSolved(twisted)).toBe(true);
  });

  it('require the cross as well as the pairs', () => {
    // Two cross edges swapped, as in the isCrossSolved test; no pair sticker is touched.
    const swapped: Face[] = [...createSolvedCube()];
    [swapped[25], swapped[16]] = ['R', 'F'];

    expect(HELD_SLOTS.every((slot) => isPairSolved(swapped, slot))).toBe(true);
    expect(isFirstTwoLayersSolved(swapped)).toBe(false);
  });
});
