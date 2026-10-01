/**
 * The fact check a model's text must pass after the notation gate (ADR-0023).
 *
 * The gate checks notation, not meaning, so a reply can name the wrong colour, place or
 * count and still pass. This check reads the claims a reader would rely on out of the text
 * and compares each with the step's facts. It is deterministic, uses no second model, and
 * reads only claims written in a shape it recognises. Anything else is left alone: the
 * check can miss a wrong claim, but it is built so that it does not refuse a true one,
 * which `fact-check.test.ts` holds it to by running the template through it.
 *
 * Three kinds of claim are checked on their own:
 *
 * - **Colours.** Every colour word must be a colour the facts mention.
 * - **Places.** Every slot phrase (`front right`) and layer phrase (`top layer`) must be a
 *   place the facts mention.
 * - **Counts.** A number is a claim only when a counted noun follows it (`five moves`,
 *   `3 edges`), or it follows `after move`. Then it must be one of the numbers the facts
 *   give for that noun. A bare number is not read, because "one" is as often a pronoun.
 *
 * And four claims tie two things together, because a true colour at a true place can
 * still be the wrong pairing:
 *
 * - **A named pair at a place:** "the green–red pair at back left".
 * - **A cross edge on a side:** "the green edge on the front".
 * - **When a cross edge went in:** "the green edge … after three moves". Every edge colour
 *   since the last such phrase in the sentence is bound to it, which is what catches
 *   several edges lumped into one count.
 * - **Where the corner or the edge started,** in a clause that names only one of them.
 *
 * And one claim about the step's own notation, which the gate lets through because every
 * move in it is real: **which moves join the pair and which insert it.** A rotation counted
 * among the joining moves is the case it was added for.
 */
import type { Face } from '../cube/types.js';
import type { ColourNames, ExplainableStep } from './explain.js';
import { factOf, type SlotRef, type StepFact } from './facts.js';
import type { HeldPosition, HeldSlot } from './held.js';

export type ClaimKind =
  | 'colour'
  | 'place'
  | 'count'
  | 'pair-place'
  | 'edge-side'
  | 'edge-timing'
  | 'piece-place'
  | 'move-role';

export interface FactMismatch {
  readonly claim: ClaimKind;
  /** The words in the text that make the claim, lower-cased. */
  readonly said: string;
  /** What the facts allow in its place, for the log. */
  readonly allowed: readonly string[];
}

export type FactCheck =
  { readonly ok: true } | { readonly ok: false; readonly mismatches: readonly FactMismatch[] };

// ─── What the facts allow ────────────────────────────────────────────────────────────

type Layer = 'top' | 'middle' | 'bottom';
type CountNoun = 'moves' | 'edges' | 'pairs' | 'corners';

/** Where a piece started, as a pair step's `pair-located` fact says. */
interface PiecePlace {
  readonly layer: Layer;
  /** The slot it is in, or the column it is above. Absent for an edge in the top layer. */
  readonly slot?: HeldSlot;
  /** The side it is on. Only for an edge in the top layer. */
  readonly side?: HeldPosition;
}

interface Allowed {
  readonly colours: ReadonlySet<Face>;
  readonly slots: ReadonlySet<HeldSlot>;
  readonly layers: ReadonlySet<Layer>;
  readonly counts: Readonly<Record<CountNoun, ReadonlySet<number>>>;
  /** `after move N`: the moves after which something happened. */
  readonly moveNumbers: ReadonlySet<number>;
  /** Each pair the facts name, by its two colours sorted, and every place they put it. */
  readonly pairs: ReadonlyMap<string, ReadonlySet<HeldSlot>>;
  /** Cross steps only: the cross colour, and each edge by its other colour. */
  readonly cross?: {
    readonly colour: Face;
    readonly edges: ReadonlyMap<Face, { side: HeldPosition; solvedAfter: number }>;
  };
  /** Pair steps only. */
  readonly corner?: PiecePlace;
  readonly edge?: PiecePlace;
}

const pairKey = (colours: readonly Face[]) => [...colours].sort().join('');

function addPair(pairs: Map<string, Set<HeldSlot>>, slot: SlotRef, ...extra: HeldSlot[]) {
  const key = pairKey(slot.colours);
  const places = pairs.get(key) ?? new Set();
  for (const place of [slot.held, ...extra]) places.add(place);
  pairs.set(key, places);
}

/**
 * Everything the facts allow the text to say, gathered once. Numbers include the obvious
 * arithmetic a reader would accept as the same fact: if the pair joins after 3 of 7 moves,
 * "the last 4 moves" is as true as "after 3 moves".
 */
function allowedBy(facts: readonly StepFact[]): Allowed {
  const colours = new Set<Face>();
  const slots = new Set<HeldSlot>();
  const layers = new Set<Layer>();
  const counts: Record<CountNoun, Set<number>> = {
    moves: new Set(),
    edges: new Set([1]),
    pairs: new Set([1, 4]),
    corners: new Set([1]),
  };
  const moveNumbers = new Set<number>();
  const pairs = new Map<string, Set<HeldSlot>>();
  let cross: Allowed['cross'];
  let corner: PiecePlace | undefined;
  let edge: PiecePlace | undefined;

  for (const fact of facts) {
    switch (fact.kind) {
      case 'cross-summary': {
        colours.add(fact.colour);
        // The cross is always solved held on the bottom (ADR-0021).
        layers.add('bottom');
        counts.edges.add(4);
        counts.moves.add(fact.moveCount).add(fact.optimalCount);
        moveNumbers.add(fact.moveCount);
        const edges = new Map<Face, { side: HeldPosition; solvedAfter: number }>();
        const groups = new Map<number, number>();
        for (const e of fact.edges) {
          colours.add(e.colour);
          edges.set(e.colour, { side: e.side, solvedAfter: e.solvedAfter });
          counts.moves.add(e.solvedAfter).add(fact.moveCount - e.solvedAfter);
          if (e.solvedAfter > 0) moveNumbers.add(e.solvedAfter);
          groups.set(e.solvedAfter, (groups.get(e.solvedAfter) ?? 0) + 1);
        }
        // "Two edges are already in place", "the other three go in after …".
        const placed = groups.get(0) ?? 0;
        for (const size of [placed, fact.edges.length - placed, ...groups.values()]) {
          counts.edges.add(size);
        }
        cross = { colour: fact.colour, edges };
        break;
      }
      case 'pair-choice': {
        // Every pair is inserted at front right, so after the rotation the chosen pair is there.
        addPair(pairs, fact.chosen, 'front-right');
        slots.add(fact.chosen.held).add('front-right');
        counts.moves.add(fact.insertLength);
        counts.pairs.add(fact.others.length).add(fact.others.length + 1);
        for (const colour of fact.chosen.colours) colours.add(colour);
        for (const other of fact.others) {
          addPair(pairs, other.slot);
          slots.add(other.slot.held);
          for (const colour of other.slot.colours) colours.add(colour);
          if (other.status === 'found') counts.moves.add(other.insertLength);
        }
        break;
      }
      case 'pair-located': {
        for (const sticker of [...fact.corner.stickers, ...fact.edge.stickers]) {
          colours.add(sticker.colour);
        }
        corner = { layer: fact.corner.layer, slot: fact.corner.column };
        slots.add(fact.corner.column);
        layers.add(fact.corner.layer).add(fact.edge.layer);
        if (fact.edge.layer === 'top') {
          edge = { layer: 'top', side: fact.edge.side };
        } else {
          edge = { layer: 'middle', slot: fact.edge.slot };
          slots.add(fact.edge.slot);
        }
        break;
      }
      case 'pair-joined': {
        const insert = fact.moveCount - fact.joinedAfter;
        counts.moves.add(fact.moveCount).add(fact.joinedAfter).add(insert);
        moveNumbers
          .add(fact.moveCount)
          .add(fact.joinedAfter)
          .add(fact.joinedAfter + 1);
        break;
      }
      case 'preserved':
      case 'also-solved': {
        counts.pairs.add(fact.slots.length);
        for (const slot of fact.slots) {
          addPair(pairs, slot);
          slots.add(slot.held);
          for (const colour of slot.colours) colours.add(colour);
        }
        break;
      }
    }
  }
  moveNumbers.delete(0);
  return {
    colours,
    slots,
    layers,
    counts,
    moveNumbers,
    pairs,
    ...(cross === undefined ? {} : { cross }),
    ...(corner === undefined ? {} : { corner }),
    ...(edge === undefined ? {} : { edge }),
  };
}

// ─── Reading the text ────────────────────────────────────────────────────────────────

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];

/** A number written as digits or as a word up to twenty. Larger words are not read. */
function numberOf(word: string): number | undefined {
  if (/^\d{1,3}$/u.test(word)) return Number(word);
  const index = NUMBER_WORDS.indexOf(word);
  return index === -1 ? undefined : index;
}

const NUMBER = String.raw`(\d{1,3}|${NUMBER_WORDS.join('|')})`;

const COUNT_NOUNS: Readonly<Record<string, CountNoun>> = {
  move: 'moves',
  moves: 'moves',
  turn: 'moves',
  turns: 'moves',
  edge: 'edges',
  edges: 'edges',
  pair: 'pairs',
  pairs: 'pairs',
  slot: 'pairs',
  slots: 'pairs',
  corner: 'corners',
  corners: 'corners',
};

/** Words that end the search for a number's noun: "two of the moves" counts nothing. */
const BREAKS: ReadonlySet<string> = new Set([
  'of',
  'and',
  'or',
  'to',
  'the',
  'a',
  'an',
  'in',
  'on',
  'at',
  'after',
  'before',
  'for',
  'with',
  'by',
  'than',
  'then',
  'is',
  'are',
  'was',
]);

/**
 * The text as the check reads it: lower case, with every dash a hyphen and typographic
 * quotes made plain, so "green–red", "green-red" and "Front-Right" all read alike.
 */
const normalise = (text: string) =>
  text
    .toLowerCase()
    .replaceAll(/[‐-―−]/gu, '-')
    .replaceAll(/[‘’]/gu, "'");

const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');

const SLOT = String.raw`(?:(top|middle|bottom)\s+)?(front|back)[\s-]+(left|right)\b`;
const SIDE = String.raw`(?:(top|middle|bottom)\s+)?(front|back|left|right)\b(?![\s-]+(?:left|right)\b)(?!\s+way\b)`;

const slotOf = (depth: string, side: string) => `${depth}-${side}` as HeldSlot;

function colourPattern(names: ColourNames): { pattern: string; faceOf: Map<string, Face> } {
  const faceOf = new Map<string, Face>();
  for (const [face, name] of Object.entries(names) as [Face, string][]) {
    faceOf.set(name.toLowerCase(), face);
  }
  const words = [...faceOf.keys()].map((word) => word.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  return { pattern: `(${words.join('|')})`, faceOf };
}

// ─── The checks ──────────────────────────────────────────────────────────────────────

interface Reader {
  /** The text lower-cased and with dashes and quotes made plain. */
  readonly text: string;
  /** The text as written, where notation's case matters. */
  readonly original: string;
  readonly step: ExplainableStep;
  readonly allowed: Allowed;
  readonly colour: string;
  readonly faceOf: ReadonlyMap<string, Face>;
  readonly names: ColourNames;
  readonly mismatches: FactMismatch[];
}

function report(reader: Reader, claim: ClaimKind, words: string, allowed: readonly string[]) {
  const said = words.trim();
  const duplicate = reader.mismatches.some((m) => m.claim === claim && m.said === said);
  if (!duplicate) reader.mismatches.push({ claim, said, allowed });
}

const sorted = <T>(values: Iterable<T>) => [...values].sort();

function checkColours(reader: Reader) {
  const { allowed, names } = reader;
  for (const match of reader.text.matchAll(new RegExp(`\\b${reader.colour}\\b`, 'gu'))) {
    const face = reader.faceOf.get(match[1]!)!;
    if (!allowed.colours.has(face)) {
      report(reader, 'colour', match[0], sorted([...allowed.colours].map((f) => names[f])));
    }
  }
}

function checkPlaces(reader: Reader) {
  const { allowed } = reader;
  for (const match of reader.text.matchAll(new RegExp(String.raw`\b${SLOT}`, 'gu'))) {
    const slot = slotOf(match[2]!, match[3]!);
    if (!allowed.slots.has(slot)) report(reader, 'place', match[0], sorted(allowed.slots));
  }
  for (const match of reader.text.matchAll(/\b(top|middle|bottom)\s+layer\b/gu)) {
    if (!allowed.layers.has(match[1] as Layer)) {
      report(reader, 'place', match[0], sorted(allowed.layers));
    }
  }
}

function checkCounts(reader: Reader) {
  const { allowed } = reader;
  const words = reader.text.replaceAll('-', ' ').match(/[a-z0-9']+|[.,;:!?()]/gu) ?? [];

  words.forEach((word, i) => {
    const n = numberOf(word);
    if (n !== undefined) {
      // The noun may follow after up to two words: "three cross edges", "two more moves".
      for (let j = i + 1; j <= i + 3 && j < words.length; j += 1) {
        const next = words[j]!;
        if (/^[.,;:!?()]$/u.test(next) || BREAKS.has(next) || numberOf(next) !== undefined) break;
        const noun = COUNT_NOUNS[next];
        if (noun === undefined) continue;
        if (!allowed.counts[noun].has(n)) {
          report(
            reader,
            'count',
            words.slice(i, j + 1).join(' '),
            sorted(allowed.counts[noun]).map(String),
          );
        }
        break;
      }
    }
    // "after move 4": a move number, not a count.
    if (/^(?:after|by|on|until)$/u.test(word) && /^(?:move|turn)$/u.test(words[i + 1] ?? '')) {
      const m = numberOf(words[i + 2] ?? '');
      if (m !== undefined && !allowed.moveNumbers.has(m)) {
        report(
          reader,
          'count',
          words.slice(i, i + 3).join(' '),
          sorted(allowed.moveNumbers).map(String),
        );
      }
    }
  });
}

function checkPairPlaces(reader: Reader) {
  const { allowed, names } = reader;
  const c = reader.colour;
  const pattern = new RegExp(
    String.raw`\b${c}\s*(?:-|/|\band\b)\s*${c}\s+(?:f2l\s+)?(?:pair|slot)\b` +
      String.raw`(?:\s+(?:is\s+|sits\s+|starts\s+|was\s+)?(?:at|in|into)\s+(?:the\s+)?${SLOT})?`,
    'gu',
  );
  for (const match of reader.text.matchAll(pattern)) {
    const key = pairKey([reader.faceOf.get(match[1]!)!, reader.faceOf.get(match[2]!)!]);
    const places = allowed.pairs.get(key);
    const known = sorted(
      [...allowed.pairs.keys()].map((k) => [...k].map((f) => names[f as Face]).join('–')),
    );
    if (places === undefined) {
      report(reader, 'pair-place', match[0], known);
    } else if (match[4] !== undefined && !places.has(slotOf(match[4], match[5]!))) {
      report(reader, 'pair-place', match[0], sorted(places));
    }
  }
}

function checkCrossEdges(reader: Reader) {
  const cross = reader.allowed.cross;
  if (cross === undefined) return;
  const c = reader.colour;

  // A cross edge on a side.
  const onSide = new RegExp(
    String.raw`\b${c}(?:\s+(?:cross\s+)?edge)?\s+(?:is\s+|sits\s+|goes\s+|belongs\s+|lands\s+|ends\s+up\s+)?(?:on|at|to)\s+the\s+${SIDE}`,
    'gu',
  );
  for (const match of reader.text.matchAll(onSide)) {
    const edge = cross.edges.get(reader.faceOf.get(match[1]!)!);
    if (edge !== undefined && edge.side !== match[3]) {
      report(reader, 'edge-side', match[0], [`${match[1]} on the ${edge.side}`]);
    }
  }

  // When each edge went in: every edge colour since the last timing phrase is bound to it.
  // "After" may drop its noun in a list: "green after four, red after five".
  const timing = new RegExp(
    String.raw`\b(?:after|by|on)\s+(?:the\s+)?(?:first\s+)?${NUMBER}\s+(?:more\s+)?(?:moves?|turns?)\b` +
      String.raw`|\b(?:after|by|on)\s+(?:move|turn)\s+${NUMBER}\b` +
      String.raw`|\bafter\s+${NUMBER}\b` +
      String.raw`|\b(already)\s+(?:in\s+place|solved|placed|home)\b`,
    'gu',
  );
  const colourWord = new RegExp(`\\b${c}\\b`, 'gu');
  for (const sentence of sentencesOf(reader.text)) {
    let from = 0;
    for (const match of sentence.matchAll(timing)) {
      const said = match[1] ?? match[2] ?? match[3];
      const after = said === undefined ? 0 : numberOf(said)!;
      const window = sentence.slice(from, match.index);
      for (const word of window.matchAll(colourWord)) {
        const face = reader.faceOf.get(word[1]!)!;
        const edge = cross.edges.get(face);
        if (face !== cross.colour && edge !== undefined && edge.solvedAfter !== after) {
          report(reader, 'edge-timing', `${word[1]} … ${match[0]}`, [
            edge.solvedAfter === 0
              ? `${word[1]} already in place`
              : `${word[1]} after ${edge.solvedAfter}`,
          ]);
        }
      }
      from = match.index + match[0].length;
    }
  }
}

/** "the corner is in the top layer at back left", in a clause that names only the corner. */
function checkPiecePlaces(reader: Reader) {
  const { corner, edge } = reader.allowed;
  if (corner === undefined || edge === undefined) return;

  const clauses = sentencesOf(reader.text).flatMap((sentence) =>
    sentence.split(/,?\s+(?:and|while|but|whereas)\s+(?=the\s+(?:corner|edge)\b)|;/u),
  );
  for (const clause of clauses) {
    const names = { corner: /\bcorner\b/u.test(clause), edge: /\bedge\b/u.test(clause) };
    // Only where a piece is, not where it goes: "into" or "to the" is a destination.
    if (names.corner === names.edge || /\binto\b|\bto\s+the\b|\bpair\b/u.test(clause)) continue;
    const piece = names.corner ? corner : edge;
    const which = names.corner ? 'corner' : 'edge';
    const fact = `${which}: ${piece.layer} layer${piece.slot ? `, ${piece.slot}` : ''}${piece.side ? `, ${piece.side}` : ''}`;

    for (const match of clause.matchAll(new RegExp(String.raw`\b${SLOT}`, 'gu'))) {
      const slot = slotOf(match[2]!, match[3]!);
      const layer = match[1] as Layer | undefined;
      if (piece.slot !== slot || (layer !== undefined && layer !== piece.layer)) {
        report(reader, 'piece-place', `${which} … ${match[0]}`, [fact]);
      }
    }
    for (const match of clause.matchAll(/\b(top|middle|bottom)\s+layer\b/gu)) {
      if (match[1] !== piece.layer) report(reader, 'piece-place', `${which} … ${match[0]}`, [fact]);
    }
    if (piece.side !== undefined) {
      const onSide = new RegExp(String.raw`\b(?:on|at)\s+the\s+${SIDE}`, 'gu');
      for (const match of clause.matchAll(onSide)) {
        const layer = match[1] as Layer | undefined;
        if (match[2] !== piece.side || (layer !== undefined && layer !== piece.layer)) {
          report(reader, 'piece-place', `${which} … ${match[0]}`, [fact]);
        }
      }
    }
  }
}

const isRotation = (token: string) => /^[xyz]/u.test(token);
const JOINS =
  /\bjoin|\bconnect|\bpairs\s+(?:up\s+)?(?:the|them|it|these)\b|\b(?:becomes?|became|forms?|formed|makes?|made)\s+(?:a|the|one)\s+pair\b/u;
const INSERTS = /\binsert|\bfinish|\bcomplete|\binto\s+(?:the|its)\s+slot\b/u;
/**
 * Not join claims: "use L to start joining" is true of the first joining move, and "the
 * joined pair" names the pair, not what the run does to it.
 */
const NOT_JOINING =
  /\b(?:start|begin)(?:s|ning|ing)?\s+(?:to\s+)?join\w*|\bjoined\s+(?:pair|pieces)\b/gu;
/** A run named with one of these before it is the instrument of the verb before it. */
const BY_MEANS_OF = /\b(?:using|with|by|via)\s*$/u;
/**
 * "the remaining moves R U R'", "leaving us with R U R'": what is left after the join. Only
 * right before the run, so in "the remaining moves finish the insert using R U R' U'" the
 * run is how the insert is done, which may be the whole step.
 */
const REMAINING =
  /(?:\bremaining(?:\s+(?:\d+|\w+))?(?:\s+(?:moves?|turns?))?|\bthe\s+rest(?:\s+of\s+the\s+(?:moves|sequence))?|\b(?:leaving|left)\s+(?:us\s+|you\s+)?with)(?:\s+(?:using|with|of))?\s*$/u;
/**
 * Where a clause starts: "…are joined, and the remaining moves using R U R' insert it", or
 * "join them and place them in the slot with R'". Not after a joining verb, so in "join
 * and insert them using R U R'" both verbs stay with the run.
 */
const CLAUSE = /,\s*(?:then|but|while)\b|;|(?<!\bjoin\w*)\s+and\b/gu;

/** What a run of moves is said to do, from the words around it. */
function roleOf(before: string, after: string) {
  // Named as what is left over: the insert, and only part of the step, never a summary.
  if (REMAINING.test(before)) return { joins: false, inserts: true, part: true };
  // Otherwise the verb is after the run, unless the run is how the verb before it in the
  // same clause is done.
  const clause = before.split(CLAUSE).at(-1)!;
  const words = (BY_MEANS_OF.test(clause) ? clause : after).replaceAll(NOT_JOINING, '');
  return { joins: JOINS.test(words), inserts: INSERTS.test(words), part: false };
}

/**
 * Which moves the text says join the pair, and which insert it: "R U R' joins them, and
 * U2 R U' R' inserts the pair". A run of the step's moves named as joining must be exactly
 * the moves before `joinedAfter`, with no rotation among them. A run named as inserting
 * must be exactly the moves after it, and so must "the remaining moves". A run said to do
 * both must run to the end of the step from no later than the move that joins the pair:
 * "U2 sets them up, then F' U' F joins and inserts them" is true when `F'` joins them.
 *
 * A run naming every move with only one verb is not checked: the facts call the whole
 * pair step its insert (`insertLength`), so "R U R' U' finishes the insert" is a summary.
 *
 * Notation is read here as words that are exactly one of the step's tokens. The notation
 * gate has already passed, so every piece of notation in the text is one of them.
 */
function checkMoveRoles(reader: Reader) {
  const { step } = reader;
  const joined = factOf(step.facts, 'pair-joined');
  if (joined === undefined) return;
  const tokens: ReadonlySet<string> = new Set(step.tokens);
  const moves = step.tokens.filter((token) => !isRotation(token));
  const joining = moves.slice(0, joined.joinedAfter).join(' ');
  const inserting = moves.slice(joined.joinedAfter).join(' ');
  const joiningAndInserting = new Set(
    moves.slice(0, Math.max(joined.joinedAfter, 1)).map((_, k) => moves.slice(k).join(' ')),
  );

  for (const sentence of sentencesOf(reader.original)) {
    // Runs of tokens, which "and" or a comma between two tokens does not break: "U and R'"
    // is one run. Any other word, or a full stop, colon or semicolon, ends a run.
    const runs: { tokens: string[]; start: number; end: number }[] = [];
    let current: (typeof runs)[number] | undefined;
    for (const match of sentence.matchAll(/\S+/gu)) {
      const word = match[0].replace(/^[("]+|[)",.;:!?]+$/gu, '');
      const end = match.index + match[0].length;
      if (tokens.has(word)) {
        if (current === undefined) {
          current = { tokens: [], start: match.index, end };
          runs.push(current);
        }
        current.tokens.push(word);
        current.end = end;
        if (/[.;:!?)]$/u.test(match[0])) current = undefined;
      } else if (word !== 'and') {
        current = undefined;
      }
    }

    runs.forEach((run, i) => {
      const said = run.tokens.filter((token) => !isRotation(token)).join(' ');
      if (said === '') return;
      // What the run does is said between the runs on either side of it.
      const before = normalise(sentence.slice(runs[i - 1]?.end ?? 0, run.start));
      const after = normalise(sentence.slice(run.end, runs[i + 1]?.start));
      const { joins, inserts, part } = roleOf(before, after);
      const whole = said === moves.join(' ');
      // Written in full here, so a rotation among the joining moves is caught.
      const written = run.tokens.join(' ');
      if (joins && inserts) {
        if (!joiningAndInserting.has(said)) {
          report(reader, 'move-role', `${written} … join and insert`, [...joiningAndInserting]);
        }
        return;
      }
      if (whole && !part) return;
      if (joins && written !== joining) {
        const allowed = joining === '' ? 'none: they start joined' : joining;
        report(reader, 'move-role', `${written} … join`, [allowed]);
      }
      if (inserts && said !== inserting) {
        report(reader, 'move-role', `${written} … insert`, [inserting]);
      }
    });
  }
}

/**
 * Whether the colours, places and counts `text` states agree with `step`'s facts. Run
 * after `checkNotation`, on text that already names only the step's moves.
 */
export function checkFacts(text: string, step: ExplainableStep, names: ColourNames): FactCheck {
  const { pattern, faceOf } = colourPattern(names);
  const reader: Reader = {
    text: normalise(text),
    original: text.replaceAll(/[\u2018\u2019]/gu, "'"),
    step,
    allowed: allowedBy(step.facts),
    colour: pattern,
    faceOf,
    names,
    mismatches: [],
  };
  checkColours(reader);
  checkPlaces(reader);
  checkCounts(reader);
  checkPairPlaces(reader);
  checkCrossEdges(reader);
  checkMoveRoles(reader);
  checkPiecePlaces(reader);
  return reader.mismatches.length === 0
    ? { ok: true }
    : { ok: false, mismatches: reader.mismatches };
}
