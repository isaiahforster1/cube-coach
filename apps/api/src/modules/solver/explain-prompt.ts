import {
  factOf,
  type ColourNames,
  type ExplainableStep,
  type PieceSticker,
  type SlotRef,
  type StepFact,
} from '@cube-coach/shared';

/**
 * The prompt a model is given to explain one step (ADR-0022 §2).
 *
 * Built from the step's tokens and facts and nothing else: no scramble, no user data, no
 * earlier steps and no template text. Pure, so the same step always gives the same
 * prompt, which is what lets the explainer cache replies by prompt.
 */

/**
 * Raised whenever the system prompt or the shape of the user prompt changes. It is part
 * of the cache key, so a new prompt never serves a reply written for the old one, and it
 * is logged with every refusal, so a refusal can be traced to the prompt that caused it.
 */
export const EXPLAIN_PROMPT_VERSION = 1;

/**
 * Fixed, and written without a single piece of notation, so nothing here can prime the
 * model to write a move that is not in the step. The two rules about quotes and
 * possessives close the two gaps the gate is known to miss (ADR-0021, step 5).
 */
export const EXPLAIN_SYSTEM_PROMPT = `You explain one step of a Rubik's Cube solve to someone learning the CFOP method. The step is either the cross or one F2L pair. You are given the step's moves and facts that a solver has already checked.

Write why this step uses these moves, for a learner, in at most three short sentences of plain text. No markdown, no lists and no headings.

Rules:
- Use only the facts given. Do not add a claim that is not in them, and do not guess.
- Write each move exactly as it appears in the move list, separated from other words by spaces. Never put quotes around a move, and never add an apostrophe-s or any other letters to one.
- Never write a move, rotation or piece of notation that is not in the move list, not even as an example.
- Name colours and places in words, as the facts do, for example "the green–red pair at front right". Never use a face letter to mean a face or a colour.

What the facts mean:
- cross-summary: the cross colour, how many moves it takes (moveCount) and the fewest possible (optimalCount), and for each edge the side it belongs on and after how many moves it was in place for good (0 means it already was).
- pair-choice: the pair solved next and where it is, the rotation that brings it to front right, how many moves its insert takes (insertLength), and what each other unsolved pair would have needed. Places here are as the cube is held before the rotation.
- pair-located: where the pair's corner and edge were when the step began, as the cube is held after the rotation.
- pair-joined: after how many moves (joinedAfter) the corner and edge became a pair. The moves after that insert it. 0 means they started joined.
- preserved: pairs already solved that stay solved.
- also-solved: pairs this step solved without aiming to.`;

// ─── Colours as words ────────────────────────────────────────────────────────────────

const nameSlot = (slot: SlotRef, names: ColourNames) => ({
  colours: slot.colours.map((colour) => names[colour]),
  held: slot.held,
});

const nameStickers = (stickers: readonly PieceSticker[], names: ColourNames) =>
  stickers.map((sticker) => ({ colour: names[sticker.colour], facing: sticker.facing }));

/**
 * A fact with every colour replaced by its name. In a fact a colour is a `Face`, so `'F'`
 * means green; left as it is, the model would learn to write "the F pair", which the gate
 * refuses, or mistake a colour for a turn. The switch is exhaustive, so a new fact kind
 * does not compile until it is handled here.
 */
function nameColours(fact: StepFact, names: ColourNames): object {
  switch (fact.kind) {
    case 'cross-summary':
      return {
        ...fact,
        colour: names[fact.colour],
        edges: fact.edges.map((edge) => ({ ...edge, colour: names[edge.colour] })),
      };
    case 'pair-choice':
      return {
        ...fact,
        chosen: nameSlot(fact.chosen, names),
        others: fact.others.map((other) => ({ ...other, slot: nameSlot(other.slot, names) })),
      };
    case 'pair-located': {
      const corner = { ...fact.corner, stickers: nameStickers(fact.corner.stickers, names) };
      const stickers = nameStickers(fact.edge.stickers, names);
      const edge =
        fact.edge.layer === 'top'
          ? { ...fact.edge, topColour: names[fact.edge.topColour], stickers }
          : { ...fact.edge, stickers };
      return { ...fact, corner, edge };
    }
    case 'pair-joined':
      return fact;
    case 'preserved':
    case 'also-solved':
      return { ...fact, slots: fact.slots.map((slot) => nameSlot(slot, names)) };
  }
}

// ─── The prompt ──────────────────────────────────────────────────────────────────────

/**
 * The user prompt for one step: what kind of step it is, its moves, and its facts as
 * JSON. JSON keeps every field the engine produced, so a fact is never lost by a
 * hand-written summary, and the system prompt explains what each kind means.
 */
export function buildStepPrompt(step: ExplainableStep, names: ColourNames): string {
  const kind = factOf(step.facts, 'cross-summary') === undefined ? 'one F2L pair' : 'the cross';
  const moves = step.tokens.length === 0 ? '(none)' : step.tokens.join(' ');
  const facts = JSON.stringify(
    step.facts.map((fact) => nameColours(fact, names)),
    null,
    2,
  );
  return `Step: ${kind}\nMoves, in order: ${moves}\nFacts:\n${facts}`;
}
