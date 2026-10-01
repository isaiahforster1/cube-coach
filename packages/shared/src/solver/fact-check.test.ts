/**
 * The fact check (ADR-0023).
 *
 * The cases are built from real solver output: one scramble, solved on yellow, whose steps
 * are printed in the comments so each expected result can be judged by reading. The
 * replies quoted in "replies the live measurement" are real model replies, cut to the
 * sentence that matters. Over 120 solves, the template is held to the promise that the
 * check does not refuse true text, and wrong claims made from it are held to the promise
 * that it catches them.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyMoves, createSolvedCube } from '../cube/cube.js';
import { parseAlgorithm } from '../cube/notation.js';
import { FACES, type Face, type Move } from '../cube/types.js';
import { solveCross } from './cross.js';
import { templateExplanation, type ColourNames, type ExplainableStep } from './explain.js';
import { checkFacts, type ClaimKind } from './fact-check.js';
import { factOf } from './facts.js';
import { solveF2L } from './f2l.js';
import { HELD_SLOTS } from './held.js';
import { ALL_MOVES } from './pieces.js';

const NAMES: ColourNames = {
  U: 'white',
  D: 'yellow',
  F: 'green',
  B: 'blue',
  R: 'red',
  L: 'orange',
};

const start = applyMoves(
  createSolvedCube(),
  parseAlgorithm("D2 R2 B2 U' L2 D F2 U2 R2 B' L' U R' F D2 L B' U2 R"),
);
/**
 * `L F' B R B'`: the yellow cross in 5 moves. Orange (left) is in after move 1, green
 * (front) after 2, red (right) after 4, blue (back) after 5.
 */
const CROSS = solveCross(start, 'D');
const PAIRS = solveF2L(start, CROSS).steps;
/**
 * `y' U R' U R2 U R'`: the orange–green pair, at front left before the `y'`. Its insert
 * takes 6 moves; the other three pairs need 7. After `y'` the corner is in the top layer
 * above back right and the edge is in the top layer on the front. They join after 4 moves.
 */
const FIRST_PAIR = PAIRS[0]!;

/** The kinds of claim that did not match, or `[]` when the text passes. */
function kinds(text: string, step: ExplainableStep): ClaimKind[] {
  const check = checkFacts(text, step, NAMES);
  return check.ok ? [] : check.mismatches.map((m) => m.claim);
}

describe('colours', () => {
  it('passes colours the facts mention, in any case', () => {
    expect(kinds('Yellow cross first, with GREEN going in second.', CROSS)).toEqual([]);
  });

  it('refuses a colour the step never mentions', () => {
    // The yellow cross's facts name yellow and its four edges. White is not among them.
    const check = checkFacts('The white centre stays on top.', CROSS, NAMES);
    expect(check).toEqual({
      ok: false,
      mismatches: [
        {
          claim: 'colour',
          said: 'white',
          allowed: ['blue', 'green', 'orange', 'red', 'yellow'],
        },
      ],
    });
  });
});

describe('places', () => {
  it('reads slot phrases however they are joined', () => {
    for (const place of ['front left', 'front-left', 'front–left', 'Front Left']) {
      expect(kinds(`The pair starts at ${place}.`, FIRST_PAIR)).toEqual([]);
    }
  });

  it('refuses a slot the cross step never mentions, and a layer no piece is in', () => {
    expect(kinds('This sets up the front right slot.', CROSS)).toEqual(['place']);
    // Both pieces start in the top layer.
    expect(kinds('The edge waits in the middle layer.', FIRST_PAIR)).toEqual([
      'place',
      'piece-place',
    ]);
  });

  it('does not read "the right way round" or "the pairs left" as places', () => {
    expect(
      kinds('The pairs left all need more, and this one goes in the right way round.', FIRST_PAIR),
    ).toEqual([]);
  });
});

describe('counts', () => {
  it('reads numbers as digits or words, with the noun up to two words later', () => {
    for (const text of [
      'It takes 5 moves.',
      'It takes five moves.',
      'It takes five-move work.',
      'Orange needs one move and two more moves bring green in.',
      'All four cross edges are placed.',
    ]) {
      expect(kinds(text, CROSS), text).toEqual([]);
    }
  });

  it('refuses a count the facts do not give', () => {
    // The cross takes 5 moves; no edge, and no tail of moves, makes 7.
    expect(kinds('It takes seven moves.', CROSS)).toEqual(['count']);
    expect(kinds('It takes 7 moves.', CROSS)).toEqual(['count']);
    expect(kinds('Blue is the last of 5 edges.', CROSS)).toEqual(['count']);
  });

  it('does not read a number with no counted noun, or one cut off by "of"', () => {
    expect(
      kinds('This one is shortest, and two of the moves are turns of the top.', FIRST_PAIR),
    ).toEqual([]);
    expect(kinds('Seven is a lot of moves.', FIRST_PAIR)).toEqual([]);
  });

  it('reads "after move N" as a move number', () => {
    expect(kinds('Green is in after move 2.', CROSS)).toEqual([]);
    expect(kinds('Something happens after move 3.', CROSS)).toEqual(['count']);
  });

  it('refuses the rotation counted among the joining moves', () => {
    // The live measurement's first finding. `y' U R' U R2` is five tokens, but the corner
    // and edge join after 4 moves: the rotation is not one of them.
    expect(kinds('The first 4 moves join the corner and edge.', FIRST_PAIR)).toEqual([]);
    expect(kinds('The first 5 moves join the corner and edge.', FIRST_PAIR)).toEqual(['count']);
  });
});

describe('a named pair at a place', () => {
  it('passes a pair at any place the facts put it, before or after the rotation', () => {
    expect(kinds('The orange–green pair at front left goes first.', FIRST_PAIR)).toEqual([]);
    expect(
      kinds('After the rotation the orange and green pair is at front right.', FIRST_PAIR),
    ).toEqual([]);
    expect(kinds('The green-orange pair sits in the front-left slot.', FIRST_PAIR)).toEqual([]);
  });

  it('refuses a pair at a place the facts never put it', () => {
    expect(kinds('The orange–green pair at back left goes first.', FIRST_PAIR)).toEqual([
      'pair-place',
    ]);
  });

  it('refuses a pair that does not exist', () => {
    // Green and blue are opposite colours: no slot lies between them.
    expect(kinds('The green–blue pair goes first.', FIRST_PAIR)).toEqual(['pair-place']);
  });
});

describe('cross edges', () => {
  it('passes each edge on its side and with its own count', () => {
    const text =
      'Orange goes in after one move and green after move 2. ' +
      'The red edge on the right is in place after four moves, and blue on the back after five moves.';
    expect(kinds(text, CROSS)).toEqual([]);
  });

  it('refuses an edge on the wrong side', () => {
    expect(kinds('The green edge belongs on the right.', CROSS)).toEqual(['edge-side']);
  });

  it('refuses edges lumped into one count', () => {
    // The live measurement's second finding: three edges given one count between them.
    const check = checkFacts(
      'The orange edge, the green edge and the red edge are solved after four moves.',
      CROSS,
      NAMES,
    );
    expect(check).toEqual({
      ok: false,
      mismatches: [
        { claim: 'edge-timing', said: 'orange … after four moves', allowed: ['orange after 1'] },
        { claim: 'edge-timing', said: 'green … after four moves', allowed: ['green after 2'] },
      ],
    });
  });

  it('binds a colour only to the next count in its own sentence', () => {
    expect(kinds('Orange is first. Red goes in after four moves.', CROSS)).toEqual([]);
  });
});

describe('where the corner and edge start', () => {
  it('passes each piece at its place, even in one sentence', () => {
    const text =
      'The corner starts in the top layer above the back right slot, and the edge is at the top front.';
    expect(kinds(text, FIRST_PAIR)).toEqual([]);
  });

  it('refuses a piece at the wrong place', () => {
    expect(kinds('The corner starts at the top front left.', FIRST_PAIR)).toEqual(['piece-place']);
    expect(kinds('The corner starts at the bottom back right.', FIRST_PAIR)).toEqual([
      'piece-place',
    ]);
    expect(kinds('The edge starts on the left side of the top layer.', FIRST_PAIR)).toEqual([
      'piece-place',
    ]);
  });

  it('does not read where a piece goes as where it is', () => {
    expect(kinds('The edge drops into the front right slot.', FIRST_PAIR)).toEqual([]);
    expect(kinds('The corner and edge are at front right at the end.', FIRST_PAIR)).toEqual([]);
    // Every pair is inserted at front right, so these are true of every pair step.
    for (const text of [
      'The corner goes in the front right slot.',
      'The corner belongs in front right.',
      'The edge needs to go to front right.',
      'The corner ends up at front right.',
      'The edge is placed at front right.',
    ]) {
      expect(kinds(text, FIRST_PAIR)).toEqual([]);
    }
  });

  it('still reads "in place" as where a piece is', () => {
    // The corner starts above back right.
    expect(kinds('The corner is already in place at front left.', FIRST_PAIR)).toEqual([
      'piece-place',
    ]);
  });
});

describe('which moves join and which insert', () => {
  // FIRST_PAIR is `y' U R' U R2 U R'`: `U R' U R2` join the pair, and `U R'` insert it.

  it('passes runs that name the joining moves and the inserting moves exactly', () => {
    const text = "Then U R' U R2 joins the corner and edge. Finally U R' inserts the pair.";
    expect(kinds(text, FIRST_PAIR)).toEqual([]);
    expect(kinds("U R' U and R2 join the corner and edge.", FIRST_PAIR)).toEqual([]);
  });

  it('passes the whole sequence named with one verb, with or without the rotation', () => {
    for (const text of [
      "Use U R' U R2 U R' because the corner and edge join after 4 moves.",
      "The moves y' U R' U R2 U R' join them and insert the pair.",
      "U R' U R2 U R' finishes the insert.",
    ]) {
      expect(kinds(text, FIRST_PAIR), text).toEqual([]);
    }
  });

  it('refuses a run said to join that is not the joining moves', () => {
    // Real replies did this: "Then R U2 R' joins the corner and edge after four moves",
    // when the four joining moves were R U2 R' F'.
    expect(
      checkFacts("Then U R' U joins the corner and edge after 4 moves.", FIRST_PAIR, NAMES),
    ).toEqual({
      ok: false,
      mismatches: [{ claim: 'move-role', said: "U R' U … join", allowed: ["U R' U R2"] }],
    });
  });

  it('refuses the rotation counted among the joining moves', () => {
    // ADR-0022's first finding, as a run of moves rather than a count.
    expect(kinds("First y' U R' U R2 join the corner and edge.", FIRST_PAIR)).toEqual([
      'move-role',
    ]);
  });

  it('refuses a run said to insert that is not the inserting moves', () => {
    expect(kinds("Finally R2 U R' inserts the pair.", FIRST_PAIR)).toEqual(['move-role']);
  });

  /** Two real replies from ADR-0023's live measurement, on the scrambles that produced them. */
  const stepOf = (scramble: string, face: Face, index: number) => {
    const start = applyMoves(createSolvedCube(), parseAlgorithm(scramble));
    const cross = solveCross(start, face);
    return [cross, ...solveF2L(start, cross).steps][index]!;
  };

  it('passes a real reply that names the joining and inserting moves correctly', () => {
    // `y' R U' F U F' R'`, joined after 5.
    const step = stepOf("L2 D2 F' B2 D R U2 L2 D B R' L B L R' U2 D' B' U' L R B L' D U'", 'L', 2);
    const text =
      "We choose the white blue pair at front left and start with y' to bring it to front right. " +
      "After five moves of R U' F U F' the corner and edge are joined into a pair. " +
      "Then we use R' to finish the insert.";
    expect(kinds(text, step)).toEqual([]);
  });

  it('refuses a real reply that gives the join one move too many', () => {
    // `y2 R F R U' F' U' R'`, joined after 4: `R F R U'` join, `F' U' R'` insert.
    const step = stepOf(
      "D2 L' U' D2 F' D L U' F2 L2 B' R L U L2 F L F' B' L F' R2 U' R F'",
      'U',
      2,
    );
    const text =
      'First, y2 brings the blue–red pair at back-left to front right. ' +
      "Then, R F R U' F' join the corner and edge into a pair after four moves. " +
      "Finally, U' R' inserts the pair into the front right slot.";
    expect(checkFacts(text, step, NAMES)).toEqual({
      ok: false,
      mismatches: [
        { claim: 'move-role', said: "R F R U' F' … join", allowed: ["R F R U'"] },
        { claim: 'move-role', said: "U' R' … insert", allowed: ["F' U' R'"] },
      ],
    });
  });

  it('leaves a run alone when nothing after it says what it does', () => {
    expect(kinds("Turn U R' U first, then the rest.", FIRST_PAIR)).toEqual([]);
  });

  it('reads the verb before a run named with "using" or "with"', () => {
    expect(kinds("They are joined after 4 moves using U R' U R2.", FIRST_PAIR)).toEqual([]);
    expect(kinds("They are joined after 4 moves using U R' U.", FIRST_PAIR)).toEqual(['move-role']);
    expect(kinds("We finish the insert with R2 U R'.", FIRST_PAIR)).toEqual(['move-role']);
  });

  it('reads the verb before a run only within its own clause', () => {
    const text = "They are joined, and the last moves using U R' insert the pair.";
    expect(kinds(text, FIRST_PAIR)).toEqual([]);
    // A real reply (seed 2028): the run after "with" is how the pair is placed, not joined.
    const placed = "Use U R' U R2 to join them after 4 moves and place them in the slot with U R'.";
    expect(kinds(placed, FIRST_PAIR)).toEqual([]);
    expect(kinds("Join and insert them using U R'.", FIRST_PAIR)).toEqual(['move-role']);
  });

  it('reads "pairs" and "connects" as joining, but not "the joined pair" or "start joining"', () => {
    expect(kinds("U R' U connects the corner and edge.", FIRST_PAIR)).toEqual(['move-role']);
    expect(kinds("U R' U pairs them up.", FIRST_PAIR)).toEqual(['move-role']);
    expect(kinds("Finally U R' inserts the joined pair.", FIRST_PAIR)).toEqual([]);
    expect(kinds('Use U to start joining the corner and edge.', FIRST_PAIR)).toEqual([]);
  });

  it('passes a run said to join and insert that runs from the join to the end', () => {
    // The pair joins on the fourth move, R2, so any run ending the step from U to R2 does both.
    for (const run of ["U R' U R2 U R'", "R' U R2 U R'", "R2 U R'"]) {
      expect(kinds(`Then ${run} joins and inserts the pair.`, FIRST_PAIR), run).toEqual([]);
    }
  });

  it('refuses a run said to join and insert that is not the end of the step', () => {
    expect(kinds("U R' U R2 U joins the corner and edge and inserts them.", FIRST_PAIR)).toEqual([
      'move-role',
    ]);
    expect(kinds("U R' joins the corner and edge and inserts them.", FIRST_PAIR)).toEqual([
      'move-role',
    ]);
  });

  it('reads "the remaining moves" as the insert, even when they name every move', () => {
    expect(kinds("The remaining moves U R' insert the pair.", FIRST_PAIR)).toEqual([]);
    expect(kinds("They are joined, leaving us with U R'.", FIRST_PAIR)).toEqual([]);
    for (const text of [
      "Finish the insert using the remaining moves U R' U R2 U R'.",
      "They are joined after 4 moves, leaving us with U R' U R2 U R'.",
      "The remaining moves using R2 U R' insert the pair.",
    ]) {
      expect(kinds(text, FIRST_PAIR), text).toEqual(['move-role']);
    }
  });

  it('passes "the remaining moves" when the run is how a verb after it is done', () => {
    // "using" names how the insert is done, and the facts call the whole step the insert.
    const text =
      "After 4 moves they are a pair, and the remaining moves finish the insert using U R' U R2 U R'.";
    expect(kinds(text, FIRST_PAIR)).toEqual([]);
  });

  /** Four of the five wrong move roles ADR-0023's seed-2027 measurement let through. */
  it('refuses the real replies the first version let through', () => {
    const cases: [scramble: string, face: Face, index: number, text: string][] = [
      [
        // `y2 F' L U2 F L'`, joined after 2: `F' L` join.
        "B D2 U' B L' D2 U B2 R2 B F2 U2 L' B2 U L' F2 B D' B' F R' D' L F",
        'B',
        1,
        "The corner is at bottom back left and the edge is at top back, and they are joined after 2 moves using F' L U2. Then the insert uses F L'.",
      ],
      [
        // `y2 R U F R F' R'`: the run said to join and insert ends in R, not R'.
        "D' L' F' R2 L' D2 U B2 L B' R2 D2 F2 B D2 B' U B2 U' L D F D B2 D'",
        'F',
        3,
        "The moves R U F R F' R join them after five moves and insert the pair.",
      ],
      [
        // `y U2 R F R F' R'`, joined after 5: only `R'` remains.
        "U F' R2 F2 D' F' R2 L D2 F L U2 L D2 L2 B' R2 U' F B2 U' B L D' R",
        'D',
        1,
        "The corner starts at top front left and the edge starts at top back, with the pieces joining after 5 moves. Finish the insert using the remaining moves U2 R F R F' R'.",
      ],
      [
        // `y2 F' U2 F U F' U' F`, joined after 5: `U' F` remain.
        "U F' R2 F2 D' F' R2 L D2 F L U2 L D2 L2 B' R2 U' F B2 U' B L D' R",
        'D',
        4,
        "The corner and edge are joined after 5 moves, leaving us with F' U2 F U F' U' F.",
      ],
    ];
    for (const [scramble, face, index, text] of cases) {
      expect(kinds(text, stepOf(scramble, face, index)), text).toEqual(['move-role']);
    }
  });
});

// ─── Over real solves ────────────────────────────────────────────────────────────────

const SCRAMBLES: Move[][] = fc.sample(
  fc.array(fc.constantFrom(...ALL_MOVES), { minLength: 20, maxLength: 25 }),
  { numRuns: 20, seed: 2107 },
);

const STEPS = FACES.flatMap((face: Face) =>
  SCRAMBLES.flatMap((scramble) => {
    const start = applyMoves(createSolvedCube(), scramble);
    const cross = solveCross(start, face);
    return [cross, ...solveF2L(start, cross).steps].map((step) => ({ face, scramble, step }));
  }),
);

describe('the fact check over 120 solves on all six cross faces', () => {
  it('passes the template, which states only facts', () => {
    for (const { face, scramble, step } of STEPS) {
      const text = templateExplanation(step, NAMES);
      expect(checkFacts(text, step, NAMES), `${face}: ${scramble.join(' ')}\n${text}`).toEqual({
        ok: true,
      });
    }
  });

  /** Mutation checks: the template with one fact made wrong must be refused. */
  it('refuses the template with a colour the step does not have', () => {
    for (const { step } of STEPS) {
      const cross = factOf(step.facts, 'cross-summary');
      const choice = factOf(step.facts, 'pair-choice');
      const crossColour =
        cross?.colour ??
        factOf(step.facts, 'pair-located')!.corner.stickers.find(
          (s) => !choice!.chosen.colours.includes(s.colour),
        )!.colour;
      const opposite = { U: 'D', D: 'U', F: 'B', B: 'F', R: 'L', L: 'R' }[crossColour] as Face;
      const text = templateExplanation(step, NAMES).replaceAll(NAMES[crossColour], NAMES[opposite]);
      expect(kinds(text, step)).toContain('colour');
    }
  });

  it('refuses the template with two cross edges on each other’s sides', () => {
    const crosses = STEPS.flatMap(({ step }) => {
      const fact = factOf(step.facts, 'cross-summary');
      return fact === undefined || fact.moveCount === 0 || fact.edges.length < 2
        ? []
        : [{ step, fact }];
    });
    for (const { step, fact } of crosses) {
      const [a, b] = fact.edges;
      const text = templateExplanation(step, NAMES)
        .replace(`${NAMES[a!.colour]} on`, '@A on')
        .replace(`${NAMES[b!.colour]} on`, `${NAMES[a!.colour]} on`)
        .replace('@A on', `${NAMES[b!.colour]} on`);
      expect(kinds(text, step)).toContain('edge-side');
    }
  });

  it('refuses every pair named at a place the facts never put it', () => {
    for (const { step } of STEPS) {
      const choice = factOf(step.facts, 'pair-choice');
      if (choice === undefined) continue;
      const other = choice.others[0]?.slot ?? choice.chosen;
      const places = new Set(
        [choice.chosen, ...choice.others.map((o) => o.slot)]
          .filter((s) => s.colours.every((c) => other.colours.includes(c)))
          .map((s) => s.held),
      );
      for (const slot of [
        ...(factOf(step.facts, 'preserved')?.slots ?? []),
        ...(factOf(step.facts, 'also-solved')?.slots ?? []),
      ]) {
        if (slot.colours.every((c) => other.colours.includes(c))) places.add(slot.held);
      }
      if (other === choice.chosen) places.add('front-right');
      const wrong = HELD_SLOTS.find((slot) => !places.has(slot));
      if (wrong === undefined) continue;
      const pair = `${NAMES[other.colours[0]]}–${NAMES[other.colours[1]]}`;
      expect(kinds(`The ${pair} pair at ${wrong.replace('-', ' ')} waits.`, step)).toContain(
        'pair-place',
      );
    }
  });

  it('passes the true joining and inserting runs, and refuses each one a move off', () => {
    for (const { step } of STEPS) {
      const joined = factOf(step.facts, 'pair-joined');
      if (joined === undefined || joined.joinedAfter === 0) continue;
      const moves = step.tokens.filter((token) => !/^[xyz]/u.test(token));
      const join = (n: number) => `${moves.slice(0, n).join(' ')} joins the corner and edge.`;
      const insert = (n: number) => `${moves.slice(n).join(' ')} inserts the pair.`;

      expect(kinds(`${join(joined.joinedAfter)} ${insert(joined.joinedAfter)}`, step)).toEqual([]);
      if (joined.joinedAfter < moves.length - 1) {
        expect(kinds(join(joined.joinedAfter + 1), step)).toEqual(['move-role']);
        expect(kinds(insert(joined.joinedAfter + 1), step)).toEqual(['move-role']);
      }
    }
  });

  /**
   * The honest limit: with a rotation, "takes N moves" counting the rotation is caught
   * only when N is not another number the step can truly claim, such as another pair's
   * insert length. This pins how often, so a change that weakens it shows up.
   */
  it('refuses over half the inserts that count the rotation as a move', () => {
    const rotated = STEPS.filter(({ step }) => factOf(step.facts, 'pair-choice')?.rotation.length);
    const caught = rotated.filter(({ step }) =>
      kinds(`Its insert takes ${step.tokens.length} moves.`, step).includes('count'),
    );
    // 243 of 426. The rest are a number the step can truly claim, such as another pair's
    // insert length, so the count alone cannot tell them apart.
    expect(rotated.length).toBeGreaterThan(400);
    expect(caught.length / rotated.length).toBeGreaterThan(0.55);
  });
});
