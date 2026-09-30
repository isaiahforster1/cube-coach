/**
 * The plain template and the notation gate (ADR-0021 §6).
 *
 * The template's sentences are checked against hand-built facts, one branch at a time, so
 * each expected line can be read and judged by a person. Over real solves, the template is
 * put through the same gate a model's text must pass, which is the promise the ADR makes:
 * the fallback can never be refused.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyMoves, createSolvedCube } from '../cube/cube.js';
import { FACES, type Face, type Move, type Token } from '../cube/types.js';
import { solveCross } from './cross.js';
import {
  checkNotation,
  chooseExplanation,
  notationIn,
  templateExplanation,
  type ColourNames,
} from './explain.js';
import type { PairLocatedFact, StepFact } from './facts.js';
import { solveF2L } from './f2l.js';
import { ALL_MOVES } from './pieces.js';

const NAMES: ColourNames = {
  U: 'white',
  D: 'yellow',
  F: 'green',
  B: 'blue',
  R: 'red',
  L: 'orange',
};

const lines = (tokens: readonly Token[], facts: readonly StepFact[]) =>
  templateExplanation({ tokens, facts }, NAMES).split('\n');

// ─── The template, one branch at a time ──────────────────────────────────────────────

describe('the template for the cross', () => {
  it('names the colour, the count, and when each edge went in for good', () => {
    const facts: StepFact[] = [
      {
        kind: 'cross-summary',
        colour: 'D',
        moveCount: 5,
        optimalCount: 5,
        edges: [
          { colour: 'F', side: 'front', solvedAfter: 2 },
          { colour: 'R', side: 'right', solvedAfter: 0 },
          { colour: 'B', side: 'back', solvedAfter: 5 },
          { colour: 'L', side: 'left', solvedAfter: 4 },
        ],
      },
    ];
    expect(lines(['R', 'U', "F'", 'D2', 'L'], facts)).toEqual([
      'Solve the yellow cross in 5 moves, the fewest this scramble allows.',
      'Its edges: green on the front (in place for good after move 2), ' +
        'red on the right (already in place), ' +
        'blue on the back (in place for good after move 5) and ' +
        'orange on the left (in place for good after move 4).',
    ]);
  });

  it('says so when the cross is already solved', () => {
    const facts: StepFact[] = [
      { kind: 'cross-summary', colour: 'U', moveCount: 0, optimalCount: 0, edges: [] },
    ];
    expect(lines(['z2'], facts)).toEqual(['The white cross is already solved.']);
  });

  it('does not claim the fewest when the counts differ', () => {
    // Never built by the engine, whose cross is optimal. The template must still not lie.
    const facts: StepFact[] = [
      { kind: 'cross-summary', colour: 'D', moveCount: 1, optimalCount: 0, edges: [] },
    ];
    expect(lines(['R'], facts)[0]).toBe(
      'Solve the yellow cross in 1 move, the fewest possible is 0.',
    );
  });
});

describe('the template for a pair', () => {
  const choice: StepFact = {
    kind: 'pair-choice',
    chosen: { colours: ['B', 'R'], held: 'back-right' },
    rotation: ["y'"],
    insertLength: 7,
    others: [
      { slot: { colours: ['F', 'L'], held: 'front-left' }, status: 'found', insertLength: 8 },
      { slot: { colours: ['B', 'L'], held: 'back-left' }, status: 'failed', limit: 'depth' },
    ],
  };
  const located: PairLocatedFact = {
    kind: 'pair-located',
    corner: {
      layer: 'top',
      column: 'front-left',
      twist: 'clockwise',
      stickers: [
        { colour: 'R', facing: 'top' },
        { colour: 'D', facing: 'front' },
        { colour: 'B', facing: 'left' },
      ],
    },
    edge: {
      layer: 'top',
      side: 'back',
      topColour: 'B',
      stickers: [
        { colour: 'B', facing: 'top' },
        { colour: 'R', facing: 'back' },
      ],
    },
  };
  const tokens: Token[] = ["y'", 'U', 'R', "U'", "R'", 'U', 'R', "U'"];
  const facts: StepFact[] = [
    choice,
    located,
    { kind: 'pair-joined', joinedAfter: 3, moveCount: 7 },
    { kind: 'preserved', slots: [{ colours: ['F', 'R'], held: 'front-left' }] },
    { kind: 'also-solved', slots: [{ colours: ['F', 'L'], held: 'back-left' }] },
  ];

  it('says why this pair, where its pieces are, and how the moves split', () => {
    expect(lines(tokens, facts)).toEqual([
      'Next, the blue–red pair, at back right as you hold the cube now.',
      'Its insert takes 7 moves, the shortest of the pairs left: ' +
        'green–orange at front left needs 8 moves and ' +
        'blue–orange at back left has no insert within the move limit.',
      "Turn the cube with y' to bring it to the front right.",
      "After y': The corner is in the top layer, above front left, with yellow facing to the front.",
      'The edge is in the top layer on the back, with blue on top.',
      'The first 3 moves join the corner and edge, and the last 4 moves insert the pair.',
      'The pair already solved stays solved: green–red at front left.',
      'This also solves the green–orange at back left pair.',
    ]);
  });

  it('agrees the verb with the number of pairs kept', () => {
    const two: StepFact = {
      kind: 'preserved',
      slots: [
        { colours: ['F', 'R'], held: 'front-left' },
        { colours: ['F', 'L'], held: 'back-left' },
      ],
    };
    expect(lines([], [two])).toEqual([
      'The pairs already solved stay solved: green–red at front left and green–orange at back left.',
    ]);
  });

  it('says "joint shortest" on a tie, and names the last pair as the last', () => {
    const tied: StepFact = {
      ...choice,
      rotation: [],
      others: [
        { slot: { colours: ['F', 'L'], held: 'front-left' }, status: 'found', insertLength: 7 },
      ],
    };
    expect(lines([], [tied])[1]).toContain('the joint shortest of the pairs left');

    const last: StepFact = { ...choice, rotation: [], others: [] };
    expect(lines([], [last])).toEqual([
      'Next, the blue–red pair, at back right as you hold the cube now.',
      'It is the last pair left, and its insert takes 7 moves.',
    ]);
  });

  it('describes each place an edge can be in the middle layer', () => {
    const middle = (fit: 'solved' | 'flipped' | 'other-slot'): StepFact[] => [
      { ...choice, rotation: [] },
      {
        ...located,
        edge: {
          layer: 'middle',
          slot: 'back-left',
          fit,
          stickers: [
            { colour: 'B', facing: 'back' },
            { colour: 'R', facing: 'left' },
          ],
        },
      },
    ];
    expect(lines([], middle('solved'))[3]).toBe(
      'The edge is already in its slot, the right way round.',
    );
    expect(lines([], middle('flipped'))[3]).toBe(
      'The edge is in its own slot at back left, but flipped.',
    );
    expect(lines([], middle('other-slot'))[3]).toBe(
      "The edge is in the middle layer at back left, in another pair's slot.",
    );
  });

  it('marks the ends of the join: joined from the start, and joined on the last move', () => {
    expect(lines([], [{ kind: 'pair-joined', joinedAfter: 0, moveCount: 3 }])).toEqual([
      'The corner and edge start joined, so all 3 moves insert them.',
    ]);
    expect(lines([], [{ kind: 'pair-joined', joinedAfter: 3, moveCount: 3 }])).toEqual([
      'The corner and edge join on the last move, which also puts them in.',
    ]);
  });

  it('says nothing about preserved pairs when there were none', () => {
    expect(
      templateExplanation({ tokens: [], facts: [{ kind: 'preserved', slots: [] }] }, NAMES),
    ).toBe('');
  });

  it('refuses to describe a located pair without knowing which pair it is', () => {
    expect(() => lines([], [located])).toThrow(/pair-choice/);
  });
});

// ─── Finding notation in prose ───────────────────────────────────────────────────────

describe('notationIn', () => {
  it.each([
    ["Do R U R' then U2.", ['R', 'U', "R'", 'U2']],
    ['Typographic primes count: U’ R’', ["U'", "R'"]],
    ["Run together: RUR'U'", ['R', 'U', "R'", "U'"]],
    ['Quoted or bracketed: (R U) and "F2"', ['R', 'U', 'F2']],
    ["Rotations and wide turns: y, x2, r', Rw", ['y', 'x2', "r'", 'Rw']],
    ['Slices and odd suffixes: M2 E S R3', ['M2', 'E', 'S', 'R3']],
  ])('finds the moves in %j', (text, expected) => {
    expect(notationIn(text)).toEqual(expected);
  });

  it.each([
    'Build the F2L pair by the front, then fly it in.',
    'A 3x3 cube has 20 movable pieces.',
    'Remember: bottom, back, down, left, right, front, up.',
  ])('finds none in %j', (text) => {
    expect(notationIn(text)).toEqual([]);
  });

  it('reads an all-caps word spelled from turn letters as notation: refused, never missed', () => {
    expect(notationIn('The RED pair')).toEqual(['R', 'E', 'D']);
  });
});

describe('checkNotation', () => {
  const tokens: Token[] = ['y', 'R', 'U', "R'"];

  it("accepts text that uses only the step's tokens", () => {
    expect(checkNotation("After the y, R U R' inserts the pair.", tokens)).toEqual({ ok: true });
  });

  it('accepts text with no notation at all', () => {
    expect(checkNotation('Pair the corner with the edge, then insert.', tokens)).toEqual({
      ok: true,
    });
  });

  it('refuses a move the step does not contain, and names it once', () => {
    expect(checkNotation("R U R' or U2 R U2 R'", tokens)).toEqual({ ok: false, unknown: ['U2'] });
  });

  it('matches exactly: no inverse, half turn or wide turn stands in for a token', () => {
    for (const text of ["U'", 'R2', 'r', 'Rw', "y'", 'M']) {
      expect(checkNotation(text, tokens).ok, text).toBe(false);
    }
  });
});

describe('chooseExplanation', () => {
  const step = {
    tokens: ['R', 'U', "R'"] as Token[],
    facts: [{ kind: 'pair-joined', joinedAfter: 0, moveCount: 3 }] as StepFact[],
  };
  const template = 'The corner and edge start joined, so all 3 moves insert them.';

  it("shows the model's text when it passes", () => {
    expect(chooseExplanation(step, "R U R' drops the pair in.", NAMES)).toEqual({
      source: 'model',
      text: "R U R' drops the pair in.",
    });
  });

  it('falls back to the template when there is no model, or it said nothing', () => {
    for (const text of [undefined, '', '  \n']) {
      expect(chooseExplanation(step, text, NAMES)).toEqual({
        source: 'template',
        text: template,
        reason: 'no-model',
      });
    }
  });

  it('throws the text away and says why when it adds a move', () => {
    expect(chooseExplanation(step, "R U2 R' works too.", NAMES)).toEqual({
      source: 'template',
      text: template,
      reason: 'refused',
      unknown: ['U2'],
    });
  });
});

// ─── Over real solves ────────────────────────────────────────────────────────────────

/** Seeded, so a failure names a scramble that can be replayed. */
const SCRAMBLES: Move[][] = fc.sample(
  fc.array(fc.constantFrom(...ALL_MOVES), { minLength: 20, maxLength: 25 }),
  { numRuns: 20, seed: 2107 },
);

const STEPS = FACES.flatMap((face: Face) =>
  SCRAMBLES.flatMap((scramble) => {
    const start = applyMoves(createSolvedCube(), scramble);
    const cross = solveCross(start, face);
    const f2l = solveF2L(start, cross);
    return [cross, ...f2l.steps].map((step) => ({ face, scramble, step }));
  }),
);

describe('the template over 120 solves on all six cross faces', () => {
  it('is never refused by the gate the model must pass', () => {
    for (const { face, scramble, step } of STEPS) {
      const text = templateExplanation(step, NAMES);
      expect(checkNotation(text, step.tokens), `${face}: ${scramble.join(' ')}\n${text}`).toEqual({
        ok: true,
      });
    }
  });

  it('writes a line for every step, with no hole where a value should be', () => {
    for (const { step } of STEPS) {
      const text = templateExplanation(step, NAMES);
      expect(text).not.toBe('');
      expect(text).not.toMatch(/undefined|NaN/u);
    }
  });

  /**
   * Mutation check. After a rotation, the solver's fixed-frame moves are true of the cube
   * but wrong for the person holding it: exactly the mistake ADR-0020 warned about. The
   * gate must refuse them, or it is not protecting anything.
   */
  it('refuses the fixed-frame moves in place of the presented ones', () => {
    const rotated = STEPS.filter(({ step }) => step.frame.rotations.length > 0);
    const refused = rotated.filter(({ step }) => {
      const fixed = step.moves.join(' ');
      const presented = step.tokens.filter((token) => !/^[xyz]/u.test(token)).join(' ');
      return fixed !== presented && !checkNotation(fixed, step.tokens).ok;
    });
    const differing = rotated.filter(
      ({ step }) =>
        step.moves.join(' ') !== step.tokens.filter((t) => !/^[xyz]/u.test(t)).join(' '),
    );

    // 554 differ, and 550 of those are refused.
    expect(differing.length).toBeGreaterThan(500);
    // Not every one: a fixed move can relabel onto another token by coincidence.
    expect(refused.length / differing.length).toBeGreaterThan(0.95);
  });
});
