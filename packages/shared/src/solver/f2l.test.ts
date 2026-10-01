import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyMoves, applySequence, createSolvedCube } from '../cube/cube.js';
import { at } from '../cube/permutations.js';
import { invertSequence, invertToken, isRotation, parseAlgorithm } from '../cube/notation.js';
import {
  FACES,
  type CubeState,
  type Face,
  type Move,
  type Rotation,
  type Token,
} from '../cube/types.js';
import { CORNER_SLOTS } from '../analysis/corners.js';
import { EDGE_SLOTS } from '../analysis/edges.js';
import { solveCross, type CrossStep } from './cross.js';
import {
  chooseInsert,
  holdAtFrontRight,
  slotsFor,
  solveF2L,
  type F2LResult,
  type Slot,
} from './f2l.js';
import { frameOf, present, setupRotationFor, type Frame } from './frame.js';
import { ALL_MOVES } from './pieces.js';
import { HELD_SLOTS, type HeldSlot } from './held.js';
import { isCrossSolved, isFirstTwoLayersSolved, isPairSolved } from './oracle.js';

const OPPOSITE: Record<Face, Face> = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

/** Seeded, so a failure names a scramble that can be replayed. */
const SCRAMBLES: Move[][] = fc.sample(
  fc.array(fc.constantFrom(...ALL_MOVES), { minLength: 20, maxLength: 25 }),
  { numRuns: 30, seed: 2104 },
);

const scrambled = (scramble: readonly Move[]) => applyMoves(createSolvedCube(), scramble);

interface Solve {
  readonly face: Face;
  readonly scramble: readonly Move[];
  readonly start: CubeState;
  readonly cross: CrossStep;
  readonly f2l: F2LResult;
}

/** 180 solves, 30 on each cross face, shared by the property and mutation tests. */
const SOLVES: Solve[] = FACES.flatMap((face) =>
  SCRAMBLES.map((scramble) => {
    const start = scrambled(scramble);
    const cross = solveCross(start, face);
    return { face, scramble, start, cross, f2l: solveF2L(start, cross) };
  }),
);

// ─── Oracle helpers: judged on the stickers, as held ─────────────────────────────────

/** The two side centres of each held slot, by facelet index. */
const HELD_SIDES: Record<HeldSlot, readonly [number, number]> = {
  'front-right': [22, 13],
  'front-left': [22, 40],
  'back-right': [49, 13],
  'back-left': [49, 40],
};

const colourKey = (faces: readonly Face[]) => [...faces].sort().join('');

/** The colours of every pair solved on the held cube, read from its centres. */
function solvedPairColours(held: CubeState): Set<string> {
  return new Set(
    HELD_SLOTS.filter((slot) => isPairSolved(held, slot)).map((slot) =>
      colourKey(HELD_SIDES[slot].map((facelet) => at(held, facelet))),
    ),
  );
}

/** First two layers solved in the right colour, on the bottom as held. */
function oracleAccepts(start: CubeState, tokens: readonly Token[], face: Face): boolean {
  const held = applySequence(start, tokens);
  return isFirstTwoLayersSolved(held) && held[31] === face;
}

const allTokens = ({ cross, f2l }: Solve): Token[] => [
  ...cross.tokens,
  ...f2l.steps.flatMap((step) => step.tokens),
];

// ─── Slots and frames ────────────────────────────────────────────────────────────────

describe('slotsFor', () => {
  it('names the D-cross slots as usual', () => {
    expect(slotsFor('D').map((slot) => slot.name)).toEqual(['FR', 'BR', 'BL', 'FL']);
  });

  it.each(FACES)('gives four distinct slots around a %s cross', (face) => {
    const slots = slotsFor(face);

    expect(slots).toHaveLength(4);
    expect(new Set(slots.map((slot) => slot.name)).size).toBe(4);
    for (const slot of slots) {
      const cornerFaces = at(CORNER_SLOTS, slot.corner).name;
      const edgeFaces = at(EDGE_SLOTS, slot.edge).name;
      expect(cornerFaces).toContain(face);
      expect(edgeFaces).not.toContain(face);
      expect(edgeFaces).not.toContain(OPPOSITE[face]);
      for (const side of slot.sides) {
        expect(cornerFaces).toContain(side);
        expect(edgeFaces).toContain(side);
      }
    }
  });
});

describe('holdAtFrontRight', () => {
  it.each(FACES)('brings every %s-cross slot to front right with at most one y', (face) => {
    const base = frameOf(setupRotationFor(face));
    for (const slot of slotsFor(face)) {
      const { added, frame } = holdAtFrontRight(slot, base);

      expect(added.length).toBeLessThanOrEqual(1);
      expect(added.every((rotation) => rotation.startsWith('y'))).toBe(true);
      expect(frame.fixedFaceAt.bottom).toBe(face);
      expect(new Set(slot.sides.map((side) => frame.heldPositionOf[side]))).toEqual(
        new Set(['front', 'right']),
      );
    }
  });
});

// ─── Worked examples ─────────────────────────────────────────────────────────────────

describe('solveF2L', () => {
  const solve = (scramble: string, face: Face = 'D') => {
    const start = scrambled(parseAlgorithm(scramble));
    return solveF2L(start, solveCross(start, face));
  };

  it('does nothing on a solved cube', () => {
    const result = solve('');

    expect(result.status).toBe('solved');
    expect(result.steps).toEqual([]);
    expect(result.alreadySolved).toHaveLength(4);
  });

  it('inserts a pair at front right without rotating', () => {
    const result = solve("R U' R'");

    expect(result.steps.map((step) => step.tokens)).toEqual([['R', 'U', "R'"]]);
  });

  it('turns the cube to bring front left to front right, then speaks in that grip', () => {
    const result = solve("L' U L");
    const step = at(result.steps, 0);

    expect(step.slot.name).toBe('FL');
    // Fixed L' U' L; after y' the fixed L face is held in front.
    expect(step.moves).toEqual(["L'", "U'", 'L']);
    expect(step.tokens).toEqual(["y'", "F'", "U'", 'F']);
  });

  it('gives the same answer every time', () => {
    const start = scrambled(at(SCRAMBLES, 0));
    const cross = solveCross(start, 'R');

    expect(solveF2L(start, cross)).toEqual(solveF2L(start, cross));
  });

  it('refuses a cross step that belongs to a different cube', () => {
    const start = scrambled(at(SCRAMBLES, 0));
    const otherCross = solveCross(scrambled(at(SCRAMBLES, 1)));

    expect(() => solveF2L(start, otherCross)).toThrow(/does not solve the cross/);
  });

  describe('fails loudly at its limits instead of widening the search', () => {
    it('by depth', () => {
      // The insert above needs three moves; allow two.
      const start = scrambled(parseAlgorithm("R U' R'"));
      const limited = solveF2L(start, solveCross(start), { maxDepth: 2, maxNodes: 2_000_000 });

      expect(limited.status).toBe('failed');
      if (limited.status === 'failed') {
        expect(limited.searches.map((s) => s.failure)).toEqual(['depth']);
      }
    });

    it('by positions visited', () => {
      const start = scrambled(at(SCRAMBLES, 0));
      const limited = solveF2L(start, solveCross(start), { maxDepth: 12, maxNodes: 1 });

      expect(limited.status).toBe('failed');
      if (limited.status === 'failed') {
        expect(limited.searches.every((s) => s.failure === 'nodes')).toBe(true);
      }
    });
  });
});

// ─── Properties over 180 solves (ADR-0021 §5) ────────────────────────────────────────

describe.each(FACES)('on the %s cross, over 30 seeded scrambles', (face) => {
  const solves = SOLVES.filter((solve) => solve.face === face);

  it('finishes, and the sticker oracle accepts the whole sequence as shown', () => {
    for (const solve of solves) {
      expect(solve.f2l.status, solve.scramble.join(' ')).toBe('solved');
      expect(oracleAccepts(solve.start, allTokens(solve), face)).toBe(true);
    }
  });

  /**
   * Performed step by step on the real cube, each step solves its pair at front right in
   * the right colours and keeps the cross and every pair solved before it.
   */
  it('keeps every earlier step intact, and solves its own pair at front right', () => {
    for (const { start, cross, f2l } of solves) {
      let held = applySequence(start, cross.tokens);
      let before = solvedPairColours(held);

      for (const step of f2l.steps) {
        held = applySequence(held, step.tokens);
        const after = solvedPairColours(held);

        expect(isCrossSolved(held)).toBe(true);
        expect(held[31]).toBe(face);
        expect(isPairSolved(held, 'front-right')).toBe(true);
        expect(colourKey(HELD_SIDES['front-right'].map((f) => at(held, f)))).toBe(
          colourKey(step.slot.sides),
        );
        for (const colours of before) expect(after.has(colours)).toBe(true);
        before = after;
      }
    }
  });

  it('shows at most one y per pair, first, and no B or D as held', () => {
    for (const { f2l } of solves) {
      for (const step of f2l.steps) {
        const [first, ...rest] = step.tokens;
        const moves = first !== undefined && isRotation(first) ? rest : step.tokens;

        expect(step.added.every((rotation) => rotation.startsWith('y'))).toBe(true);
        expect(moves.some(isRotation)).toBe(false);
        expect(moves.some((token) => token.startsWith('B') || token.startsWith('D'))).toBe(false);
        expect(moves.length).toBeLessThanOrEqual(12);
      }
    }
  });

  it('accounts for every slot exactly once', () => {
    for (const { f2l } of solves) {
      const names = [
        ...f2l.alreadySolved,
        ...f2l.steps.flatMap((step) => [step.slot, ...step.alsoSolved]),
      ].map((slot: Slot) => slot.name);

      expect([...names].sort()).toEqual(
        slotsFor(face)
          .map((slot) => slot.name)
          .sort(),
      );
    }
  });

  /**
   * Re-derives the greedy choice from the searches the step records: nothing shorter was
   * found, and a rotation was only taken when no equally short insert avoided one.
   */
  it('chose the shortest insert, preferring no new rotation', () => {
    for (const { f2l } of solves) {
      for (const step of f2l.steps) {
        const found = step.searches.flatMap((s) => (s.status === 'found' ? [s] : []));
        const shortest = Math.min(...found.map((s) => s.moves.length));
        const tied = found.filter((s) => s.moves.length === shortest);

        expect(step.moves.length).toBe(shortest);
        if (tied.some((s) => s.added.length === 0)) expect(step.added).toEqual([]);
        expect(chooseInsert(step.searches)?.slot).toBe(step.slot);
      }
    }
  });
});

/**
 * Mutation check (ADR-0021 §5), as for the cross: re-present the solver's correct
 * fixed-frame inserts through a broken translation, and confirm the oracle notices. The
 * claim is about effects, not strings. The oracle may accept a mutated answer only if it
 * moves every piece exactly as the correct one does, and it must reject most of them.
 */
describe('mutation check: a broken F2L translation is caught by the oracle', () => {
  const piecesAfter = (start: CubeState, tokens: readonly Token[]) =>
    applySequence(start, [
      ...tokens,
      ...invertSequence(tokens.filter((token): token is Rotation => isRotation(token))),
    ]);

  const swapHeld = (frame: Frame, a: Face, b: Face): Frame => ({
    ...frame,
    heldPositionOf: {
      ...frame.heldPositionOf,
      [a]: frame.heldPositionOf[b],
      [b]: frame.heldPositionOf[a],
    },
  });

  type Mutation = (step: Solve['f2l']['steps'][number], previous: Frame) => Token[];

  const mutations: Record<string, Mutation> = {
    // The y is shown, but the moves are still translated in the grip before it.
    'rotation shown, not translated': (step, previous) => present(step.moves, step.added, previous),
    // The moves are translated for the new grip, but the y is never shown.
    'rotation translated, not shown': (step) => present(step.moves, [], step.frame),
    // The y is shown the wrong way round.
    'rotation shown inverted': (step) => [
      ...step.added.map((rotation) => invertToken(rotation)),
      ...step.tokens.slice(step.added.length),
    ],
    // Left and right swapped within the step's own grip.
    'R and L swapped': (step) => present(step.moves, step.added, swapHeld(step.frame, 'R', 'L')),
  };

  it.each(Object.keys(mutations))('%s', (name) => {
    const mutate = mutations[name] ?? (() => []);
    let rejected = 0;

    for (const solve of SOLVES) {
      let previous = solve.cross.frame;
      const pairTokens: Token[] = [];
      for (const step of solve.f2l.steps) {
        pairTokens.push(...mutate(step, previous));
        previous = step.frame;
      }
      const tokens = [...solve.cross.tokens, ...pairTokens];

      if (oracleAccepts(solve.start, tokens, solve.face)) {
        expect(piecesAfter(solve.start, tokens), tokens.join(' ')).toEqual(
          piecesAfter(solve.start, allTokens(solve)),
        );
      } else {
        rejected += 1;
      }
    }

    // Not vacuous: the oracle had to catch the mutation on most of the 180 solves.
    expect(rejected).toBeGreaterThan(SOLVES.length / 2);
  });
});
