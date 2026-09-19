import { describe, expect, it } from 'vitest';
import { applyMoves, isSolved } from '../cube/cube.js';
import {
  caseClassOf,
  caseShape,
  everyLastLayerCase,
  isFirstTwoLayersSolved,
  isLastLayerOriented,
  isLastLayerSolved,
  lastLayerPermutation,
} from './last-layer.js';
import { familyOf, movesOf, PLL_CASES, positionOf } from './pll.js';

describe('the PLL library', () => {
  it('has a unique label for every case', () => {
    const ids = PLL_CASES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The strongest claim the library makes, and it costs nothing to check: every
   * algorithm, run backwards from a solved cube, must produce a position where only the
   * top layer is out of place and the top face is finished.
   *
   * A single mistyped move almost always breaks one of these, which is why the library
   * could be assembled at all — the engine refuses anything that is not a real case.
   */
  it.each(PLL_CASES)('leaves everything but the top layer alone: $id', (entry) => {
    const position = positionOf(entry);

    expect(isFirstTwoLayersSolved(position)).toBe(true);
    expect(isLastLayerOriented(position)).toBe(true);
  });

  it.each(PLL_CASES)('actually solves its own case: $id', (entry) => {
    expect(isSolved(applyMoves(positionOf(entry), movesOf(entry)))).toBe(true);
  });

  it.each(PLL_CASES)('is a case rather than an already-solved cube: $id', (entry) => {
    expect(isLastLayerSolved(lastLayerPermutation(positionOf(entry)))).toBe(false);
  });

  it.each(PLL_CASES)('is filed under the family it really belongs to: $id', (entry) => {
    expect(familyOf(positionOf(entry))).toBe(entry.family);
  });

  /**
   * Two labels pointing at the same case would be invisible by eye — the algorithms look
   * nothing alike — and would mean the library is silently missing one.
   */
  it('has no two entries that are the same case', () => {
    const classes = PLL_CASES.map((entry) => caseClassOf(lastLayerPermutation(positionOf(entry))));
    expect(new Set(classes).size).toBe(PLL_CASES.length);
  });

  /**
   * Completeness, proved rather than asserted.
   *
   * The engine works out how many last-layer cases can exist by enumerating every legal
   * arrangement of four corners and four edges and collapsing the ones that only differ
   * by adjusting the top layer or turning the cube round. That number is 21 plus the
   * solved cube — the familiar count, arrived at without anyone looking it up — and the
   * library has to hit every one.
   */
  it('covers every case that can exist, and nothing else', () => {
    const possible = everyLastLayerCase();
    const covered = new Set(
      PLL_CASES.map((entry) => caseClassOf(lastLayerPermutation(positionOf(entry)))),
    );

    const solved = caseClassOf({ corners: [0, 1, 2, 3], edges: [0, 1, 2, 3] });
    const needed = new Set([...possible].filter((entry) => entry !== solved));

    expect(possible.size).toBe(22);
    expect(needed.size).toBe(21);
    expect(PLL_CASES).toHaveLength(21);
    expect([...covered].sort()).toEqual([...needed].sort());
  });
});

/**
 * The shapes the families promise. Each is a statement about the cube that the engine
 * can check, so "this is an A perm" stops being something the reader has to take on
 * trust and becomes something the tests enforce.
 */
describe('what each family does', () => {
  function shapeOf(id: string) {
    const entry = PLL_CASES.find((candidate) => candidate.id === id);
    if (entry === undefined) throw new Error(`No case ${id}`);
    return caseShape(lastLayerPermutation(positionOf(entry)));
  }

  it.each(['Aa', 'Ab'])('%s cycles three corners and leaves the edges alone', (id) => {
    expect(shapeOf(id)).toEqual({ corners: [3], edges: [] });
  });

  it('E swaps two pairs of corners and leaves the edges alone', () => {
    expect(shapeOf('E')).toEqual({ corners: [2, 2], edges: [] });
  });

  it.each(['Ua', 'Ub'])('%s cycles three edges and leaves the corners alone', (id) => {
    expect(shapeOf(id)).toEqual({ corners: [], edges: [3] });
  });

  it.each(['H', 'Z'])('%s swaps two pairs of edges and leaves the corners alone', (id) => {
    expect(shapeOf(id)).toEqual({ corners: [], edges: [2, 2] });
  });

  it.each(['Ga', 'Gb', 'Gc', 'Gd'])('%s cycles three corners and three edges', (id) => {
    expect(shapeOf(id)).toEqual({ corners: [3], edges: [3] });
  });

  it.each(['F', 'Ja', 'Jb', 'Na', 'Nb', 'Ra', 'Rb', 'T', 'V', 'Y'])(
    '%s swaps a pair of corners and a pair of edges',
    (id) => {
      expect(shapeOf(id)).toEqual({ corners: [2], edges: [2] });
    },
  );

  /** Aa and Ab must go opposite ways round, or one of them is a duplicate. */
  it('has the two A perms cycling opposite ways', () => {
    const [aa, ab] = ['Aa', 'Ab'].map((id) => {
      const entry = PLL_CASES.find((candidate) => candidate.id === id);
      return caseClassOf(lastLayerPermutation(positionOf(entry as (typeof PLL_CASES)[number])));
    });

    expect(aa).not.toBe(ab);
  });
});
