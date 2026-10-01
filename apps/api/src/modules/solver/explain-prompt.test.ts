import { describe, expect, it } from 'vitest';
import {
  applyMoves,
  createSolvedCube,
  FACES,
  notationIn,
  parseAlgorithm,
  solveCross,
  solveF2L,
  STANDARD_COLOUR_NAMES,
  type ExplainableStep,
  type StepFact,
} from '@cube-coach/shared';
import { buildStepPrompt, EXPLAIN_SYSTEM_PROMPT } from './explain-prompt.js';

const SCRAMBLES = [
  "D2 R2 B2 U' L2 D F2 U2 R2 B' L' U R' F D2 L B' U2 R",
  "F2 U' B2 D R2 U L2 D' F2 R' B' U2 F' L D' R2 B U' F",
  "L2 D' F2 U B2 R2 D2 B' U' L' F R2 U2 B D' L2 F' R' U2",
];

/** Every step the solver produces for these scrambles, on every cross face. */
const realSteps: ExplainableStep[] = SCRAMBLES.flatMap((scramble) =>
  FACES.flatMap((face) => {
    const start = applyMoves(createSolvedCube(), parseAlgorithm(scramble));
    const cross = solveCross(start, face);
    return [cross, ...solveF2L(start, cross).steps];
  }),
);

/** The facts part of a prompt: everything after the moves line. */
const factsPart = (prompt: string) => prompt.slice(prompt.indexOf('\nFacts:\n'));

describe('buildStepPrompt', () => {
  it('gives the same prompt for the same step', () => {
    for (const step of realSteps) {
      expect(buildStepPrompt(step, STANDARD_COLOUR_NAMES)).toBe(
        buildStepPrompt(structuredClone(step), STANDARD_COLOUR_NAMES),
      );
    }
  });

  it("lists the step's moves exactly, separated by spaces", () => {
    for (const step of realSteps) {
      const prompt = buildStepPrompt(step, STANDARD_COLOUR_NAMES);
      expect(prompt).toContain(`\nMoves, in order: ${step.tokens.join(' ')}\n`);
    }
  });

  /**
   * The promise in ADR-0022 §2: once colours are named, the only notation the model sees
   * is the step's own. A colour left as a face letter would show up here as a quoted
   * single capital.
   */
  it('names every colour, so the facts hold no notation beyond the step’s tokens', () => {
    for (const step of realSteps) {
      const facts = factsPart(buildStepPrompt(step, STANDARD_COLOUR_NAMES));
      expect(facts).not.toMatch(/"[URFDLB]"/u);
      for (const move of notationIn(facts)) expect(step.tokens).toContain(move);
    }
  });

  it('includes every fact the step has', () => {
    for (const step of realSteps) {
      const facts = factsPart(buildStepPrompt(step, STANDARD_COLOUR_NAMES));
      for (const fact of step.facts) expect(facts).toContain(`"kind": "${fact.kind}"`);
    }
  });

  it('carries every fact kind, with each colour as a word', () => {
    // Hand-built, because `also-solved` is rare in real solves.
    const slot = { colours: ['F', 'R'], held: 'front-right' } as const;
    const facts: StepFact[] = [
      {
        kind: 'cross-summary',
        colour: 'D',
        moveCount: 1,
        optimalCount: 1,
        edges: [{ colour: 'B', side: 'back', solvedAfter: 1 }],
      },
      {
        kind: 'pair-choice',
        chosen: slot,
        rotation: ['y'],
        insertLength: 3,
        others: [
          { slot: { colours: ['L', 'B'], held: 'back-left' }, status: 'found', insertLength: 7 },
        ],
      },
      {
        kind: 'pair-located',
        corner: {
          layer: 'top',
          column: 'front-right',
          twist: 'none',
          stickers: [
            { colour: 'D', facing: 'top' },
            { colour: 'F', facing: 'front' },
            { colour: 'R', facing: 'right' },
          ],
        },
        edge: {
          layer: 'top',
          side: 'back',
          topColour: 'R',
          stickers: [
            { colour: 'R', facing: 'top' },
            { colour: 'F', facing: 'back' },
          ],
        },
      },
      { kind: 'pair-joined', joinedAfter: 1, moveCount: 3 },
      { kind: 'preserved', slots: [slot] },
      { kind: 'also-solved', slots: [slot] },
    ];

    const prompt = buildStepPrompt({ tokens: ['y', 'R', 'U', "R'"], facts }, STANDARD_COLOUR_NAMES);
    for (const fact of facts) expect(prompt).toContain(`"kind": "${fact.kind}"`);
    for (const name of ['yellow', 'blue', 'green', 'red', 'orange']) {
      expect(prompt).toContain(`"${name}"`);
    }
    expect(factsPart(prompt)).not.toMatch(/"[URFDLB]"/u);
    expect(prompt).toMatch(/^Step: the cross\n/u);
  });

  it('names a pair step as a pair', () => {
    const pair = realSteps.find((step) => step.facts.some((fact) => fact.kind === 'pair-choice'));
    expect(buildStepPrompt(pair!, STANDARD_COLOUR_NAMES)).toMatch(/^Step: one F2L pair\n/u);
  });
});

describe('the system prompt', () => {
  it('contains no notation at all, so it cannot prime a move', () => {
    expect(notationIn(EXPLAIN_SYSTEM_PROMPT)).toEqual([]);
  });
});
