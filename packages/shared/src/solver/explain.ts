/**
 * What the person reads for each step (ADR-0021 §6).
 *
 * Two things live here. {@link templateExplanation} turns a step's facts into plain
 * sentences, with no model involved: it is what is shown when no model is configured, and
 * the fallback whenever a model's text is refused. {@link checkNotation} is the gate a
 * model's text must pass: every piece of move notation in it must be one of that step's
 * tokens. {@link chooseExplanation} puts the two together, with the fact check from
 * `fact-check.ts` (ADR-0023) after the gate.
 *
 * The template only restates facts. It adds no reasoning of its own, so anything it says
 * was built and re-derived by the engine. Colour names are passed in, because the colour
 * scheme belongs to the interface (see `types.ts`), not the engine.
 */
import type { Face, Token } from '../cube/types.js';
import { checkFacts, type FactMismatch } from './fact-check.js';
import {
  factOf,
  type AlsoSolvedFact,
  type CornerLocation,
  type CrossSummaryFact,
  type EdgeLocation,
  type OtherSlot,
  type PairChoiceFact,
  type PairJoinedFact,
  type PairLocatedFact,
  type PreservedFact,
  type SlotRef,
  type StepFact,
} from './facts.js';
import type { HeldPosition, HeldSlot } from './held.js';

/** What a colour is called, for each fixed face. The web app's `FACE_NAMES` fits. */
export type ColourNames = Readonly<Record<Face, string>>;

/** The parts of a `CrossStep` or `PairStep` an explanation is built from. */
export interface ExplainableStep {
  readonly tokens: readonly Token[];
  readonly facts: readonly StepFact[];
}

// ─── Words ───────────────────────────────────────────────────────────────────────────

const moves = (count: number) => `${count} ${count === 1 ? 'move' : 'moves'}`;

const slotWords = (slot: HeldSlot) => slot.replace('-', ' ');

const FACING_WORDS: Readonly<Record<HeldPosition, string>> = {
  top: 'up',
  bottom: 'down',
  front: 'to the front',
  back: 'to the back',
  left: 'to the left',
  right: 'to the right',
};

const SIDE_WORDS: Readonly<Record<HeldPosition, string>> = {
  top: 'the top',
  bottom: 'the bottom',
  front: 'the front',
  back: 'the back',
  left: 'the left',
  right: 'the right',
};

/** `green–red`: a pair named by its two side colours. */
const pairName = (slot: SlotRef, names: ColourNames) =>
  `${names[slot.colours[0]]}–${names[slot.colours[1]]}`;

/** `a`, `a and b`, `a, b and c`. */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

// ─── One sentence group per fact ─────────────────────────────────────────────────────

function crossSentences(fact: CrossSummaryFact, names: ColourNames): string[] {
  const colour = names[fact.colour];
  if (fact.moveCount === 0) return [`The ${colour} cross is already solved.`];

  const fewest =
    fact.moveCount === fact.optimalCount
      ? 'the fewest this scramble allows'
      : `the fewest possible is ${fact.optimalCount}`;
  const edges = fact.edges.map((edge) => {
    const when =
      edge.solvedAfter === 0
        ? 'already in place'
        : `in place for good after move ${edge.solvedAfter}`;
    return `${names[edge.colour]} on ${SIDE_WORDS[edge.side]} (${when})`;
  });
  return [
    `Solve the ${colour} cross in ${moves(fact.moveCount)}, ${fewest}.`,
    `Its edges: ${list(edges)}.`,
  ];
}

function otherWords(other: OtherSlot, names: ColourNames): string {
  const name = `${pairName(other.slot, names)} at ${slotWords(other.slot.held)}`;
  if (other.status === 'found') return `${name} needs ${moves(other.insertLength)}`;
  return other.limit === 'depth'
    ? `${name} has no insert within the move limit`
    : `${name} hit the search limit`;
}

function choiceSentences(fact: PairChoiceFact, names: ColourNames): string[] {
  const where = slotWords(fact.chosen.held);
  const sentences = [
    `Next, the ${pairName(fact.chosen, names)} pair, at ${where} as you hold the cube now.`,
  ];

  if (fact.others.length === 0) {
    sentences.push(`It is the last pair left, and its insert takes ${moves(fact.insertLength)}.`);
  } else {
    const lengths = fact.others.flatMap((o) => (o.status === 'found' ? [o.insertLength] : []));
    const tied = lengths.includes(fact.insertLength);
    const rank = tied ? 'joint shortest' : 'shortest';
    sentences.push(
      `Its insert takes ${moves(fact.insertLength)}, the ${rank} of the pairs left: ` +
        `${list(fact.others.map((o) => otherWords(o, names)))}.`,
    );
  }

  if (fact.rotation.length > 0) {
    sentences.push(`Turn the cube with ${fact.rotation.join(' ')} to bring it to the front right.`);
  }
  return sentences;
}

function cornerSentence(corner: CornerLocation, crossColour: Face, names: ColourNames): string {
  const cross = corner.stickers.find((sticker) => sticker.colour === crossColour);
  if (cross === undefined) throw new Error('The corner has no cross-colour sticker');
  const column = slotWords(corner.column);
  const where =
    corner.layer === 'top'
      ? `in the top layer, above ${column}`
      : `in the bottom layer, at ${column}`;
  return `The corner is ${where}, with ${names[crossColour]} facing ${FACING_WORDS[cross.facing]}.`;
}

function edgeSentence(edge: EdgeLocation, names: ColourNames): string {
  if (edge.layer === 'top') {
    return `The edge is in the top layer on ${SIDE_WORDS[edge.side]}, with ${names[edge.topColour]} on top.`;
  }
  const slot = slotWords(edge.slot);
  switch (edge.fit) {
    case 'solved':
      return `The edge is already in its slot, the right way round.`;
    case 'flipped':
      return `The edge is in its own slot at ${slot}, but flipped.`;
    case 'other-slot':
      return `The edge is in the middle layer at ${slot}, in another pair's slot.`;
  }
}

function locatedSentences(
  fact: PairLocatedFact,
  choice: PairChoiceFact,
  names: ColourNames,
): string[] {
  // The corner's one colour that is not a side colour is the cross colour.
  const crossColour = fact.corner.stickers
    .map((sticker) => sticker.colour)
    .find((colour) => !choice.chosen.colours.includes(colour));
  if (crossColour === undefined) throw new Error('The corner has no cross-colour sticker');

  const grip = choice.rotation.length > 0 ? `After ${choice.rotation.join(' ')}: ` : '';
  return [
    `${grip}${cornerSentence(fact.corner, crossColour, names)}`,
    edgeSentence(fact.edge, names),
  ];
}

function joinedSentences(fact: PairJoinedFact): string[] {
  if (fact.moveCount === 0) return [];
  if (fact.joinedAfter === 0) {
    return [`The corner and edge start joined, so all ${moves(fact.moveCount)} insert them.`];
  }
  if (fact.joinedAfter === fact.moveCount) {
    return [`The corner and edge join on the last move, which also puts them in.`];
  }
  const insert = fact.moveCount - fact.joinedAfter;
  return [
    `The first ${moves(fact.joinedAfter)} join the corner and edge, ` +
      `and the last ${moves(insert)} insert the pair.`,
  ];
}

function slotList(slots: readonly SlotRef[], names: ColourNames): string {
  return list(slots.map((slot) => `${pairName(slot, names)} at ${slotWords(slot.held)}`));
}

function preservedSentences(fact: PreservedFact, names: ColourNames): string[] {
  if (fact.slots.length === 0) return [];
  const [noun, verb] = fact.slots.length === 1 ? ['The pair', 'stays'] : ['The pairs', 'stay'];
  return [`${noun} already solved ${verb} solved: ${slotList(fact.slots, names)}.`];
}

/** `the green–orange pair at back left and the blue–red pair at back right`. */
function alsoSolvedSentences(fact: AlsoSolvedFact, names: ColourNames): string[] {
  const pairs = fact.slots.map(
    (slot) => `the ${pairName(slot, names)} pair at ${slotWords(slot.held)}`,
  );
  return [`This also solves ${list(pairs)}.`];
}

// ─── The template ────────────────────────────────────────────────────────────────────

/**
 * The plain explanation of one step: a line per fact, in the step's fact order. Every
 * claim in it is a fact, and every move it names is one of the step's tokens, which the
 * tests check by running it through {@link checkNotation}.
 */
export function templateExplanation(step: ExplainableStep, names: ColourNames): string {
  const choice = factOf(step.facts, 'pair-choice');
  const lines = step.facts.flatMap((fact): string[] => {
    switch (fact.kind) {
      case 'cross-summary':
        return crossSentences(fact, names);
      case 'pair-choice':
        return choiceSentences(fact, names);
      case 'pair-located':
        if (choice === undefined) throw new Error('A located pair needs its pair-choice fact');
        return locatedSentences(fact, choice, names);
      case 'pair-joined':
        return joinedSentences(fact);
      case 'preserved':
        return preservedSentences(fact, names);
      case 'also-solved':
        return alsoSolvedSentences(fact, names);
    }
  });
  return lines.join('\n');
}

// ─── The notation gate ───────────────────────────────────────────────────────────────

/**
 * One piece of notation: an outer-layer turn (uppercase, with an optional `w` for wide),
 * a slice turn (`M E S`), a rotation, or a lowercase wide turn, with any suffix a person
 * might write. Wider than what the engine performs on purpose: text that says `r` or `M`
 * names a move the step does not contain, and must be caught, not ignored.
 */
const UPPER = String.raw`[URFDLBMES]w?(?:2'|'|2|3)?`;
const LOWER = String.raw`[xyzrufdlb](?:2'|'|2|3)?`;

/** A word that is all notation: uppercase turns may run together (`RUR'`), lowercase may not. */
const UPPER_RUN = new RegExp(`^(?:${UPPER})+$`, 'u');
const LOWER_ONE = new RegExp(`^${LOWER}$`, 'u');
const ONE_MOVE = new RegExp(UPPER, 'gu');

/** Cubing terms that look like notation but are not moves. */
const NOT_NOTATION: ReadonlySet<string> = new Set(['F2L']);

/**
 * Every piece of move notation in `text`, in order, with typographic primes made ASCII.
 *
 * Text is split into words at anything that is not a letter, digit or apostrophe. A word
 * counts as notation when it is made entirely of turns. Lowercase counts only as a word on
 * its own (`y`, `r'`), because words such as "by" and "fly" are made of lowercase turn
 * letters. Uppercase counts even when run together, since "RUR'" is a common way to write
 * moves and hardly any English word is spelled only from U R F D L B M E S in capitals.
 */
export function notationIn(text: string): string[] {
  const words = text
    .replaceAll('’', "'")
    .split(/[^A-Za-z0-9']+/u)
    .map((word) => word.replace(/^'+/u, ''))
    .filter((word) => word !== '' && !NOT_NOTATION.has(word));

  return words.flatMap((word) => {
    if (LOWER_ONE.test(word)) return [word];
    if (UPPER_RUN.test(word)) return word.match(ONE_MOVE) ?? [];
    return [];
  });
}

export type NotationCheck =
  { readonly ok: true } | { readonly ok: false; readonly unknown: readonly string[] };

/**
 * Whether every piece of notation in `text` is one of `tokens` (ADR-0021 §6). The match is
 * exact: `R2'` is not `R2`, and `R` does not stand for `R'`. Anything else is refused,
 * because the model may explain the moves but may never add one.
 */
export function checkNotation(text: string, tokens: readonly Token[]): NotationCheck {
  const allowed: ReadonlySet<string> = new Set(tokens);
  const unknown = [...new Set(notationIn(text).filter((move) => !allowed.has(move)))];
  return unknown.length === 0 ? { ok: true } : { ok: false, unknown };
}

export type Explanation =
  | { readonly source: 'model'; readonly text: string }
  | { readonly source: 'template'; readonly text: string; readonly reason: 'no-model' }
  | {
      readonly source: 'template';
      readonly text: string;
      readonly reason: 'refused';
      /** The notation that caused the model's text to be refused, for logging. */
      readonly unknown: readonly string[];
    }
  | {
      readonly source: 'template';
      readonly text: string;
      readonly reason: 'contradicted';
      /** The claims in the model's text that disagree with the facts, for logging. */
      readonly mismatches: readonly FactMismatch[];
    };

/**
 * The text to show for a step: the model's, if there is one and it passes both the
 * notation gate and the fact check (ADR-0023), or else the template. The gate runs first,
 * so a text that adds a move is `refused` whatever else it says. `modelText` is
 * `undefined` when no model is configured or it gave nothing back; blank text is treated
 * the same way.
 */
export function chooseExplanation(
  step: ExplainableStep,
  modelText: string | undefined,
  names: ColourNames,
): Explanation {
  const template = () => templateExplanation(step, names);
  if (modelText === undefined || modelText.trim() === '') {
    return { source: 'template', text: template(), reason: 'no-model' };
  }
  const notation = checkNotation(modelText, step.tokens);
  if (!notation.ok) {
    return { source: 'template', text: template(), reason: 'refused', unknown: notation.unknown };
  }
  const facts = checkFacts(modelText, step, names);
  if (!facts.ok) {
    return {
      source: 'template',
      text: template(),
      reason: 'contradicted',
      mismatches: facts.mismatches,
    };
  }
  return { source: 'model', text: modelText };
}
