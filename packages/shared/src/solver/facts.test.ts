/**
 * Every fact the engine builds, re-derived a different way (ADR-0021 §5 and §6).
 *
 * The engine reads the fixed-frame state with the piece readers and translates positions
 * through the frame. These tests never do either. They perform the presented tokens on the
 * real cube, rotations included, and read the facts off the stickers: a sticker's block is
 * where it faces as held, and its label is its colour. The sticker groups below are this
 * file's own, checked against the move tables rather than taken from `analysis/`.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crossDifficulty } from '../analysis/cross.js';
import { applyMoves, applySequence, applyToken, createSolvedCube } from '../cube/cube.js';
import { at, MOVE_PERMUTATIONS } from '../cube/permutations.js';
import { parseAlgorithm } from '../cube/notation.js';
import { FACES, type CubeState, type Face, type Move } from '../cube/types.js';
import { solveCross, type CrossStep } from './cross.js';
import {
  factOf,
  locateCorner,
  pairFacts,
  type CornerLocation,
  type CornerTwist,
  type CrossSummaryFact,
  type EdgeLocation,
  type PairChoiceFact,
  type PairLocatedFact,
  type PieceSticker,
  type SlotRef,
  type StepFact,
} from './facts.js';
import {
  slotsFor,
  solveF2L,
  type F2LResult,
  type FoundSearch,
  type PairStep,
  type Slot,
} from './f2l.js';
import { present, SCRAMBLE_FRAME } from './frame.js';
import { HELD_SLOTS, type HeldPosition, type HeldSlot } from './held.js';
import { ALL_MOVES } from './pieces.js';
import { isPairSolved } from './oracle.js';

// ─── This file's own reading of the held cube ────────────────────────────────────────

/** Sticker block `i` faces this way as held. Written out from the layout in `types.ts`. */
const BLOCK: readonly HeldPosition[] = ['top', 'right', 'front', 'bottom', 'left', 'back'];
const facing = (facelet: number): HeldPosition => at(BLOCK, Math.floor(facelet / 9));
const centre = (held: HeldPosition) => BLOCK.indexOf(held) * 9 + 4;

/**
 * Each corner position's three facelets, top or bottom first, then clockwise seen from
 * outside. Anchored at top-front-right: looking at that corner, the top is up, the right
 * face is down to the right and the front face down to the left, so clockwise is top,
 * right, front. The test below proves the other seven agree with it.
 */
const CORNERS: readonly (readonly [number, number, number])[] = [
  [8, 9, 20],
  [6, 18, 38],
  [0, 36, 47],
  [2, 45, 11],
  [29, 26, 15],
  [27, 44, 24],
  [33, 53, 42],
  [35, 17, 51],
];

const EDGES: readonly (readonly [number, number])[] = [
  [7, 19],
  [5, 10],
  [1, 46],
  [3, 37],
  [28, 25],
  [32, 16],
  [34, 52],
  [30, 43],
  [23, 12],
  [21, 41],
  [48, 14],
  [50, 39],
];

/** The bottom edge under each side, as bottom facelet then side facelet. */
const BOTTOM_EDGE: Readonly<
  Record<'front' | 'right' | 'back' | 'left', readonly [number, number]>
> = { front: [28, 25], right: [32, 16], back: [34, 52], left: [30, 43] };

const SLOT_SIDES: Readonly<Record<HeldSlot, readonly [HeldPosition, HeldPosition]>> = {
  'front-right': ['front', 'right'],
  'front-left': ['front', 'left'],
  'back-right': ['back', 'right'],
  'back-left': ['back', 'left'],
};

/** Same members, in any order. */
const sameSet = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((item) => b.includes(item));

/** The facelets of the piece with exactly these colours, in the table's order. */
function findPiece<T extends readonly number[]>(
  held: CubeState,
  table: readonly T[],
  colours: readonly Face[],
): T {
  const found = table.find((facelets) =>
    sameSet(
      facelets.map((f) => at(held, f)),
      colours,
    ),
  );
  if (found === undefined) throw new Error(`No piece is ${colours.join('')}`);
  return found;
}

const stickersOf = (held: CubeState, facelets: readonly number[]): PieceSticker[] =>
  facelets.map((f) => ({ colour: at(held, f), facing: facing(f) }));

const byFacing = (stickers: readonly PieceSticker[]) =>
  [...stickers].sort((a, b) => a.facing.localeCompare(b.facing));

/** The held slot whose two side centres show these colours. */
function heldSlotOf(held: CubeState, colours: readonly Face[]): HeldSlot {
  const slot = HELD_SLOTS.find((s) =>
    sameSet(
      SLOT_SIDES[s].map((side) => at(held, centre(side))),
      colours,
    ),
  );
  if (slot === undefined) throw new Error(`No held slot is between ${colours.join('')}`);
  return slot;
}

const slotOnCube = (held: CubeState, slot: Slot): SlotRef => ({
  colours: slot.sides,
  held: heldSlotOf(held, slot.sides),
});

const slotBetween = (sides: readonly HeldPosition[]): HeldSlot => {
  const slot = HELD_SLOTS.find((s) => sameSet(SLOT_SIDES[s], sides));
  if (slot === undefined) throw new Error(`No slot between ${sides.join(' ')}`);
  return slot;
};

function readCorner(held: CubeState, colours: readonly Face[], cross: Face): CornerLocation {
  const facelets = findPiece(held, CORNERS, colours);
  const stickers = stickersOf(held, facelets);
  const vertical = stickers.findIndex((s) => s.facing === 'top' || s.facing === 'bottom');
  const crossAt = stickers.findIndex((s) => s.colour === cross);
  const twist: CornerTwist = (['none', 'clockwise', 'anticlockwise'] as const)[
    (crossAt - vertical + 3) % 3
  ] as CornerTwist;
  return {
    layer: at(stickers, vertical).facing === 'top' ? 'top' : 'bottom',
    column: slotBetween(stickers.filter((_, i) => i !== vertical).map((s) => s.facing)),
    twist,
    stickers: byFacing(stickers),
  };
}

function readEdge(held: CubeState, colours: readonly Face[]): EdgeLocation {
  const stickers = stickersOf(held, findPiece(held, EDGES, colours));
  const top = stickers.find((s) => s.facing === 'top');
  const side = stickers.find((s) => s.facing !== 'top');
  if (top !== undefined && side !== undefined) {
    return { layer: 'top', side: side.facing, topColour: top.colour, stickers: byFacing(stickers) };
  }
  // In the middle: judged against the centres the stickers sit next to.
  const matching = stickers.filter((s) => at(held, centre(s.facing)) === s.colour).length;
  const ownSlot = sameSet(
    stickers.map((s) => at(held, centre(s.facing))),
    colours,
  );
  return {
    layer: 'middle',
    slot: slotBetween(stickers.map((s) => s.facing)),
    fit: matching === 2 ? 'solved' : ownSlot ? 'flipped' : 'other-slot',
    stickers: byFacing(stickers),
  };
}

/** Next to each other, with the same colour on both faces they share. */
function joinedOnCube(held: CubeState, slot: Slot, cross: Face): boolean {
  const corner = findPiece(held, CORNERS, [cross, ...slot.sides]);
  return findPiece(held, EDGES, slot.sides).every((edgeFacelet) => {
    const beside = corner.find((f) => facing(f) === facing(edgeFacelet));
    return beside !== undefined && at(held, beside) === at(held, edgeFacelet);
  });
}

/** The colours of every pair solved on the held cube, per the oracle, with where each is. */
function solvedSlots(held: CubeState): SlotRef[] {
  return HELD_SLOTS.filter((s) => isPairSolved(held, s)).map((s) => ({
    colours: SLOT_SIDES[s].map((side) => at(held, centre(side))) as [Face, Face],
    held: s,
  }));
}

/** Compares slot lists as sets: order and colour order are not facts. */
const normaliseSlots = (slots: readonly SlotRef[]) =>
  slots
    .map((s) => `${s.held}:${[...s.colours].sort().join('')}`)
    .sort()
    .join(' ');

// ─── The sticker groups are right ────────────────────────────────────────────────────

describe("this file's sticker groups", () => {
  const all = (groups: readonly (readonly number[])[]) => groups.flat().sort((a, b) => a - b);

  it('cover every corner and edge facelet exactly once', () => {
    const corners = FACES.flatMap((_, b) => [0, 2, 6, 8].map((i) => b * 9 + i));
    const edges = FACES.flatMap((_, b) => [1, 3, 5, 7].map((i) => b * 9 + i));

    expect(all(CORNERS)).toEqual(corners.sort((a, b) => a - b));
    expect(all(EDGES)).toEqual(edges.sort((a, b) => a - b));
  });

  /**
   * Every face turn is a rigid rotation, so it carries each corner's facelets, in
   * clockwise order, onto another corner's facelets in clockwise order. If any corner were
   * listed anticlockwise, some move would land on it the wrong way round. With the anchor
   * above, that makes all eight right.
   */
  it('keep pieces together, and every corner reads the same way round', () => {
    const cyclic = (a: readonly number[], b: readonly number[]) =>
      [0, 1, 2].some((shift) => a.every((f, i) => f === b[(i + shift) % 3]));

    for (const move of ALL_MOVES) {
      // MOVE_PERMUTATIONS[m][i] is the facelet whose sticker lands on i; invert it.
      const permutation = MOVE_PERMUTATIONS[move];
      const destination = new Array<number>(54);
      permutation.forEach((source, target) => (destination[source] = target));
      const moved = (f: number) => at(destination, f);

      for (const corner of CORNERS) {
        expect(
          CORNERS.some((c) => cyclic(corner.map(moved), c)),
          `${move}`,
        ).toBe(true);
      }
      for (const edge of EDGES) {
        expect(EDGES.some((e) => sameSet(edge.map(moved), e))).toBe(true);
      }
    }
  });
});

// ─── Worked examples a person can check ──────────────────────────────────────────────

describe('facts, worked by hand', () => {
  const start = (scramble: string) => applyMoves(createSolvedCube(), parseAlgorithm(scramble));
  const dFrontRight = slotsFor('D').find((slot) => slot.name === 'FR') as Slot;

  /**
   * After R, the D-F-R corner is at top front right with its D sticker on the front. From
   * the top sticker, clockwise goes right then front, so the D sticker is two steps
   * clockwise: one step anticlockwise. Kociemba's corner-orientation table for R agrees: it
   * gives the piece R brings to top front right a counter-clockwise twist.
   */
  it('R leaves the front-right corner on top, twisted anticlockwise', () => {
    const corner = locateCorner(start('R'), dFrontRight, 'D', SCRAMBLE_FRAME);

    expect(corner).toMatchObject({ layer: 'top', column: 'front-right', twist: 'anticlockwise' });
    expect(corner.stickers).toContainEqual({ colour: 'D', facing: 'front' });
    expect({ ...corner, stickers: byFacing(corner.stickers) }).toEqual(
      readCorner(start('R'), ['D', 'F', 'R'], 'D'),
    );
  });

  it("R U' R' is undone as R U R', joined after the first R", () => {
    const scrambled = start("R U' R'");
    const f2l = solveF2L(scrambled, solveCross(scrambled));
    const step = at(f2l.steps, 0);

    expect(step.tokens).toEqual(['R', 'U', "R'"]);
    expect(factOf(step.facts, 'pair-choice')).toEqual({
      kind: 'pair-choice',
      chosen: { colours: ['F', 'R'], held: 'front-right' },
      rotation: [],
      insertLength: 3,
      others: [],
    });
    // R U' lifts the pair out whole, so undoing it rejoins the pair with the first R.
    expect(factOf(step.facts, 'pair-joined')).toEqual({
      kind: 'pair-joined',
      joinedAfter: 1,
      moveCount: 3,
    });
    expect(factOf(step.facts, 'preserved')?.slots).toHaveLength(3);
    expect(factOf(step.facts, 'also-solved')).toBeUndefined();
  });

  /**
   * No shortest insert in the sample splits a pair once joined, so the search never tells
   * "first joined" from "joined for good". This hand-made insert does: after R U' R', the
   * moves R R' R U R' join the pair, split it, then join it for good after the third move.
   */
  it('counts the join that lasts, not the first one', () => {
    const before = start("R U' R'");
    const moves: Move[] = ['R', "R'", 'R', 'U', "R'"];
    const chosen: FoundSearch = {
      slot: dFrontRight,
      added: [],
      frame: SCRAMBLE_FRAME,
      nodes: 0,
      status: 'found',
      moves,
    };
    const facts = pairFacts({
      before,
      crossColour: 'D',
      previous: SCRAMBLE_FRAME,
      chosen,
      searches: [chosen],
      solvedBefore: [],
      alsoSolved: [],
    });

    const joined = [0, 1, 2, 3, 4, 5].map((n) =>
      joinedOnCube(applyMoves(before, moves.slice(0, n)), dFrontRight, 'D'),
    );
    expect(joined).toEqual([false, true, false, true, true, true]);
    expect(factOf(facts, 'pair-joined')?.joinedAfter).toBe(3);
  });

  it("names a front-left pair where it is before the y', and locates it after", () => {
    const scrambled = start("L' U L");
    const step = at(solveF2L(scrambled, solveCross(scrambled)).steps, 0);

    expect(step.tokens).toEqual(["y'", "F'", "U'", 'F']);
    expect(factOf(step.facts, 'pair-choice')?.chosen.held).toBe('front-left');
    // After y' the corner is above front right: the edge went up with it.
    expect(factOf(step.facts, 'pair-located')?.corner.column).toBe('front-right');
  });

  it('counts an already-solved cross as zero moves, every edge solved from the start', () => {
    expect(factOf(solveCross(start("R U R'")).facts, 'cross-summary')).toMatchObject({
      moveCount: 0,
      optimalCount: 0,
      edges: expect.arrayContaining([expect.objectContaining({ solvedAfter: 0 })]),
    });
  });
});

// ─── Every fact, re-derived on the real cube, over 180 solves ────────────────────────

/** Seeded, so a failure names a scramble that can be replayed. */
const SCRAMBLES: Move[][] = fc.sample(
  fc.array(fc.constantFrom(...ALL_MOVES), { minLength: 20, maxLength: 25 }),
  { numRuns: 30, seed: 2106 },
);

interface Solve {
  readonly face: Face;
  readonly scramble: readonly Move[];
  readonly start: CubeState;
  readonly cross: CrossStep;
  readonly f2l: F2LResult;
}

const SOLVES: Solve[] = FACES.flatMap((face) =>
  SCRAMBLES.map((scramble) => {
    const start = applyMoves(createSolvedCube(), scramble);
    const cross = solveCross(start, face);
    return { face, scramble, start, cross, f2l: solveF2L(start, cross) };
  }),
);

function rederiveCross({ start, cross, scramble, face }: Solve): CrossSummaryFact {
  let held = applySequence(start, cross.setup);
  const moves = cross.tokens.slice(cross.setup.length);
  const history = [held];
  for (const token of moves) {
    held = applyToken(held, token);
    history.push(held);
  }

  const bottom = at(held, centre('bottom'));
  const edges = (['front', 'right', 'back', 'left'] as const).map((side) => {
    const [under, beside] = BOTTOM_EDGE[side];
    const solved = history.map(
      (state) => at(state, under) === bottom && at(state, beside) === at(state, centre(side)),
    );
    let solvedAfter = moves.length;
    while (solvedAfter > 0 && at(solved, solvedAfter - 1)) solvedAfter -= 1;
    return { colour: at(held, centre(side)), side, solvedAfter };
  });

  return {
    kind: 'cross-summary',
    colour: bottom,
    moveCount: moves.length,
    optimalCount: crossDifficulty(scramble, face),
    edges,
  };
}

/** What one pair step's facts should be, read off `held`, the cube as the step begins. */
function rederivePair(held: CubeState, step: PairStep, cross: Face): StepFact[] {
  const others = step.searches
    .filter((search) => search.slot !== step.slot)
    .map((search) => {
      const slot = slotOnCube(held, search.slot);
      return search.status === 'found'
        ? { slot, status: 'found' as const, insertLength: search.moves.length }
        : { slot, status: 'failed' as const, limit: search.failure };
    });

  const turned = applySequence(held, step.added);
  const moves = step.tokens.slice(step.added.length);

  let joinedAfter = 0;
  let state = turned;
  for (const [index, token] of moves.entries()) {
    if (!joinedOnCube(state, step.slot, cross)) joinedAfter = index + 1;
    state = applyToken(state, token);
  }

  const solvedBefore = solvedSlots(turned).map((s) => normaliseSlots([s]));
  const after = solvedSlots(state);
  const chosen = normaliseSlots([slotOnCube(state, step.slot)]);

  return [
    {
      kind: 'pair-choice',
      chosen: slotOnCube(held, step.slot),
      rotation: step.added,
      insertLength: moves.length,
      others,
    },
    {
      kind: 'pair-located',
      corner: readCorner(turned, [cross, ...step.slot.sides], cross),
      edge: readEdge(turned, step.slot.sides),
    },
    { kind: 'pair-joined', joinedAfter, moveCount: moves.length },
    { kind: 'preserved', slots: after.filter((s) => solvedBefore.includes(normaliseSlots([s]))) },
    {
      kind: 'also-solved',
      slots: after.filter((s) => {
        const key = normaliseSlots([s]);
        return !solvedBefore.includes(key) && key !== chosen;
      }),
    },
  ];
}

/** Puts the engine's facts in the shape the re-derivation produces, for comparison. */
function normalise(facts: readonly StepFact[]): unknown[] {
  const hasAlsoSolved = facts.some((fact) => fact.kind === 'also-solved');
  return [
    ...facts.map((fact) => {
      switch (fact.kind) {
        case 'cross-summary':
          return { ...fact, edges: [...fact.edges].sort((a, b) => a.side.localeCompare(b.side)) };
        case 'pair-choice':
          return {
            ...fact,
            chosen: normaliseSlots([fact.chosen]),
            others: fact.others.map((o) => ({ ...o, slot: normaliseSlots([o.slot]) })),
          };
        case 'pair-located':
          return {
            ...fact,
            corner: { ...fact.corner, stickers: byFacing(fact.corner.stickers) },
            edge: { ...fact.edge, stickers: byFacing(fact.edge.stickers) },
          };
        case 'preserved':
        case 'also-solved':
          return { ...fact, slots: normaliseSlots(fact.slots) };
        default:
          return fact;
      }
    }),
    // The engine omits an empty also-solved; the re-derivation always has one.
    ...(hasAlsoSolved ? [] : [{ kind: 'also-solved', slots: '' }]),
  ];
}

/** Replays a solve and gives each pair step with the cube it began on. */
function* pairSteps({ start, cross, f2l }: Solve): Generator<[CubeState, PairStep]> {
  let held = applySequence(start, cross.tokens);
  for (const step of f2l.steps) {
    yield [held, step];
    held = applySequence(held, step.tokens);
  }
}

describe.each(FACES)('on the %s cross, every fact re-derived on the stickers', (face) => {
  const solves = SOLVES.filter((solve) => solve.face === face);

  it('cross-summary: optimal, and each edge solved for good when the engine says', () => {
    for (const solve of solves) {
      const fact = factOf(solve.cross.facts, 'cross-summary');

      expect(fact?.moveCount).toBe(fact?.optimalCount);
      expect(normalise(solve.cross.facts), solve.scramble.join(' ')).toEqual(
        normalise([rederiveCross(solve)]),
      );
    }
  });

  it('pair-choice, pair-located, pair-joined, preserved and also-solved', () => {
    for (const solve of solves) {
      expect(solve.f2l.status).toBe('solved');
      for (const [held, step] of pairSteps(solve)) {
        expect(normalise(step.facts), solve.scramble.join(' ')).toEqual(
          normalise(rederivePair(held, step, face)),
        );
      }
    }
  });

  /**
   * `pair-choice` claims an insert length for every other slot. Each is backed by a real
   * insert: performed on the cube as held, it solves that pair and keeps everything solved
   * before. So no claimed length is shorter than an insert that exists, and the chosen one
   * is no longer than any of them.
   */
  it('pair-choice: every length claimed is an insert that works on the real cube', () => {
    for (const solve of solves) {
      for (const [held, step] of pairSteps(solve)) {
        const choice = factOf(step.facts, 'pair-choice') as PairChoiceFact;
        // By colour, since a y moves where each solved pair is held.
        const coloursOf = (state: CubeState) =>
          solvedSlots(state).map((s) => [...s.colours].sort().join(''));
        const before = coloursOf(held);

        for (const search of step.searches) {
          if (search.status !== 'found') continue;
          const after = applySequence(held, present(search.moves, search.added, search.frame));

          expect(isPairSolved(after, 'front-right')).toBe(true);
          expect(heldSlotOf(after, search.slot.sides)).toBe('front-right');
          expect(coloursOf(after)).toEqual(expect.arrayContaining(before));
          expect(choice.insertLength).toBeLessThanOrEqual(search.moves.length);
        }
      }
    }
  });
});

// ─── Mutation check ──────────────────────────────────────────────────────────────────

/**
 * The comparison above has only passed so far, so break the engine the way ADR-0021 warns
 * about: facts that are true but told in the wrong grip. Each mutation rebuilds one fact
 * with the other grip, and must be caught on every step with a rotation, where the two
 * grips differ. Such steps must exist, or the check proves nothing.
 */
describe('mutation check: facts told in the wrong grip are caught', () => {
  /** The fixed-frame cube as a step begins, and the grip before its rotation. */
  const beforeStep = (solve: Solve, index: number) => ({
    state: applyMoves(solve.start, [
      ...solve.cross.moves,
      ...solve.f2l.steps.slice(0, index).flatMap((s) => s.moves),
    ]),
    previous: index === 0 ? solve.cross.frame : at(solve.f2l.steps, index - 1).frame,
  });

  const cases = SOLVES.flatMap((solve) =>
    [...pairSteps(solve)].flatMap(([held, step], index) =>
      step.added.length > 0 ? [{ solve, held, step, ...beforeStep(solve, index) }] : [],
    ),
  );

  type Case = (typeof cases)[number];

  const mutations: Record<string, (c: Case) => StepFact> = {
    // The corner located in the grip before the rotation, not the one the moves are in.
    'pair-located before the rotation': ({ solve, step, state, previous }) => ({
      kind: 'pair-located',
      corner: locateCorner(state, step.slot, solve.face, previous),
      edge: (factOf(step.facts, 'pair-located') as PairLocatedFact).edge,
    }),
    // The choice named after the rotation, where the chosen slot is always front right.
    'pair-choice after the rotation': ({ solve, step, state }) =>
      factOf(
        pairFacts({
          before: state,
          crossColour: solve.face,
          previous: step.frame,
          chosen: step.searches.find(
            (s): s is FoundSearch => s.slot === step.slot && s.status === 'found',
          ) as FoundSearch,
          searches: step.searches,
          solvedBefore: [],
          alsoSolved: [],
        }),
        'pair-choice',
      ) as PairChoiceFact,
  };

  it('has steps with a rotation to test on', () => {
    expect(cases.length).toBeGreaterThan(100);
  });

  it.each(Object.keys(mutations))('%s', (name) => {
    const mutate = mutations[name] as (c: Case) => StepFact;
    for (const c of cases) {
      const mutated = mutate(c);
      const expected = rederivePair(c.held, c.step, c.solve.face).find(
        (fact) => fact.kind === mutated.kind,
      ) as StepFact;

      expect(normalise([mutated])[0]).not.toEqual(normalise([expected])[0]);
    }
  });
});
