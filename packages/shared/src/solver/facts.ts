/**
 * What the explanation of each step may say (ADR-0021 §6).
 *
 * The AI receives a step's tokens and these facts, and nothing else. So every fact is
 * built here, by the engine, from the same fixed-frame state the solver searched, and
 * `facts.test.ts` re-derives each one a different way: on the real cube, rotations
 * performed, read from the stickers.
 *
 * Two vocabularies, never mixed (see `held.ts`). A {@link Face} in a fact is a colour: the
 * label on a sticker, which is the fixed face whose centre has that colour. Where anything
 * is, is always a {@link HeldPosition} or {@link HeldSlot}, in the grip stated on the fact.
 */
import { applyMove } from '../cube/cube.js';
import { at } from '../cube/permutations.js';
import {
  FACELETS_PER_FACE,
  FACES,
  type CubeState,
  type Face,
  type Move,
  type Rotation,
} from '../cube/types.js';
import { CORNER_SLOTS } from '../analysis/corners.js';
import { crossDistance, crossSlotsFor } from '../analysis/cross.js';
import { EDGE_SLOTS } from '../analysis/edges.js';
import type { FoundSearch, Slot, SlotSearch } from './f2l.js';
import type { Frame } from './frame.js';
import { heldSlotBetween, type HeldPosition, type HeldSlot } from './held.js';
import { cornerDigits, edgeDigits } from './pieces.js';

// ─── The facts ───────────────────────────────────────────────────────────────────────

/** An F2L slot named both ways: by its two side colours, and where it is as held. */
export interface SlotRef {
  readonly colours: readonly [Face, Face];
  readonly held: HeldSlot;
}

/** The cross, as a whole. Held positions are in the cross step's grip. */
export interface CrossSummaryFact {
  readonly kind: 'cross-summary';
  /** The cross colour. */
  readonly colour: Face;
  readonly moveCount: number;
  /** The fewest moves any cross needs here. Always equal to `moveCount`: the cross is optimal. */
  readonly optimalCount: number;
  /** One entry per cross edge. */
  readonly edges: readonly {
    /** The edge's other colour. */
    readonly colour: Face;
    /** The side it belongs on, as held: where the centre of that colour is. */
    readonly side: HeldPosition;
    /**
     * After how many moves it was solved for good: solved then, and at every move after.
     * 0 when it was solved before the cross began.
     */
    readonly solvedAfter: number;
  }[];
}

/** Why this pair was solved next. Held positions are in the grip before the step's rotation. */
export interface PairChoiceFact {
  readonly kind: 'pair-choice';
  readonly chosen: SlotRef;
  /** The rotation that brings it to front right. Empty when it is already there. */
  readonly rotation: readonly Rotation[];
  readonly insertLength: number;
  /** Every other slot unsolved at the time, and what its search found. */
  readonly others: readonly OtherSlot[];
}

export type OtherSlot =
  | { readonly slot: SlotRef; readonly status: 'found'; readonly insertLength: number }
  | { readonly slot: SlotRef; readonly status: 'failed'; readonly limit: 'depth' | 'nodes' };

/** One sticker of a piece: its colour and which way it faces, as held. */
export interface PieceSticker {
  readonly colour: Face;
  readonly facing: HeldPosition;
}

/**
 * How a corner sits, judged by its cross-colour sticker. `none` when that sticker faces the
 * top or bottom. Otherwise the corner reads as turned that way from there: `clockwise`
 * when the cross colour is one sticker clockwise from the top or bottom one, looking at
 * the corner from outside.
 */
export type CornerTwist = 'none' | 'clockwise' | 'anticlockwise';

export interface CornerLocation {
  readonly layer: 'top' | 'bottom';
  /** The two sides the corner sits between. */
  readonly column: HeldSlot;
  readonly twist: CornerTwist;
  readonly stickers: readonly PieceSticker[];
}

/**
 * Where an F2L edge sits. With the cross solved it is never in the bottom layer. In the
 * middle layer, `fit` says whether it is in its own slot the right way round (`solved`),
 * in its own slot with its colours swapped (`flipped`), or in another slot.
 */
export type EdgeLocation =
  | {
      readonly layer: 'top';
      readonly side: HeldPosition;
      readonly topColour: Face;
      readonly stickers: readonly PieceSticker[];
    }
  | {
      readonly layer: 'middle';
      readonly slot: HeldSlot;
      readonly fit: 'solved' | 'flipped' | 'other-slot';
      readonly stickers: readonly PieceSticker[];
    };

/** Where the pair's pieces were when the step began. Held after the step's rotation. */
export interface PairLocatedFact {
  readonly kind: 'pair-located';
  readonly corner: CornerLocation;
  readonly edge: EdgeLocation;
}

/**
 * When the corner and edge became a pair: next to each other, matching on both faces they
 * share. From `joinedAfter` moves on they stay joined to the end, so the moves before it
 * set the pair up and the rest insert it. 0 when they started joined. Counts moves only,
 * not the rotation.
 */
export interface PairJoinedFact {
  readonly kind: 'pair-joined';
  readonly joinedAfter: number;
  readonly moveCount: number;
}

/** Pairs solved before the step and still solved after it. Held after the step. */
export interface PreservedFact {
  readonly kind: 'preserved';
  readonly slots: readonly SlotRef[];
}

/** Pairs this insert solved without aiming to, which get no step of their own. Held after. */
export interface AlsoSolvedFact {
  readonly kind: 'also-solved';
  readonly slots: readonly SlotRef[];
}

export type StepFact =
  | CrossSummaryFact
  | PairChoiceFact
  | PairLocatedFact
  | PairJoinedFact
  | PreservedFact
  | AlsoSolvedFact;

/** The fact of one kind in a step's list, if it has one. */
export function factOf<K extends StepFact['kind']>(
  facts: readonly StepFact[],
  kind: K,
): Extract<StepFact, { kind: K }> | undefined {
  return facts.find((fact): fact is Extract<StepFact, { kind: K }> => fact.kind === kind);
}

// ─── Reading pieces in the fixed frame ───────────────────────────────────────────────

/** The fixed face a facelet is on. The state is unrotated, so this is where it is. */
const faceOfFacelet = (facelet: number): Face => at(FACES, Math.floor(facelet / FACELETS_PER_FACE));

function stickersAt(state: CubeState, facelets: readonly number[], frame: Frame): PieceSticker[] {
  return facelets.map((facelet) => ({
    colour: at(state, facelet),
    facing: frame.heldPositionOf[faceOfFacelet(facelet)],
  }));
}

/** The facelets a corner piece is on now, in its slot's clockwise order. */
const cornerFacelets = (state: CubeState, piece: number) =>
  at(CORNER_SLOTS, Math.floor(at(cornerDigits(state), piece) / 3)).facelets;

/** The facelets an edge piece is on now. */
const edgeFacelets = (state: CubeState, piece: number) =>
  at(EDGE_SLOTS, at(edgeDigits(state), piece) >> 1).facelets;

const isVertical = (position: HeldPosition) => position === 'top' || position === 'bottom';

const slotRef = (slot: Slot, frame: Frame): SlotRef => ({
  colours: slot.sides,
  held: heldSlotBetween(frame.heldPositionOf[slot.sides[0]], frame.heldPositionOf[slot.sides[1]]),
});

export function locateCorner(
  state: CubeState,
  slot: Slot,
  crossColour: Face,
  frame: Frame,
): CornerLocation {
  // Clockwise order survives the translation to held positions: rotations never mirror.
  const stickers = stickersAt(state, cornerFacelets(state, slot.corner), frame);
  const vertical = stickers.findIndex((sticker) => isVertical(sticker.facing));
  const cross = stickers.findIndex((sticker) => sticker.colour === crossColour);
  const sides = stickers.filter((sticker) => !isVertical(sticker.facing));
  const [a, b] = sides.map((sticker) => sticker.facing);
  if (vertical === -1 || cross === -1 || a === undefined || b === undefined) {
    throw new Error(`Corner ${at(CORNER_SLOTS, slot.corner).name} cannot be read as held`);
  }

  const twists: readonly CornerTwist[] = ['none', 'clockwise', 'anticlockwise'];
  return {
    layer: at(stickers, vertical).facing === 'top' ? 'top' : 'bottom',
    column: heldSlotBetween(a, b),
    twist: at(twists, (cross - vertical + 3) % 3),
    stickers,
  };
}

export function locateEdge(state: CubeState, slot: Slot, frame: Frame): EdgeLocation {
  const stickers = stickersAt(state, edgeFacelets(state, slot.edge), frame);
  const [first, second] = stickers;
  if (first === undefined || second === undefined) throw new Error('An edge has two stickers');

  const top = stickers.find((sticker) => sticker.facing === 'top');
  const side = stickers.find((sticker) => sticker.facing !== 'top');
  if (top !== undefined && side !== undefined) {
    return { layer: 'top', side: side.facing, topColour: top.colour, stickers };
  }
  if (stickers.some((sticker) => sticker.facing === 'bottom')) {
    throw new Error('An F2L edge is in the bottom layer, so the cross is not solved');
  }

  const home = (sticker: PieceSticker) => frame.heldPositionOf[sticker.colour];
  const fit = stickers.every((sticker) => home(sticker) === sticker.facing)
    ? 'solved'
    : home(first) === second.facing && home(second) === first.facing
      ? 'flipped'
      : 'other-slot';
  return { layer: 'middle', slot: heldSlotBetween(first.facing, second.facing), fit, stickers };
}

/**
 * True when the pair's corner and edge are next to each other and match on both faces
 * they share. Frame-free: joined or not does not depend on how the cube is held.
 */
export function isPairJoined(state: CubeState, slot: Slot): boolean {
  const corner = cornerFacelets(state, slot.corner);
  return edgeFacelets(state, slot.edge).every((edgeFacelet) => {
    const face = faceOfFacelet(edgeFacelet);
    const cornerFacelet = corner.find((facelet) => faceOfFacelet(facelet) === face);
    return cornerFacelet !== undefined && at(state, cornerFacelet) === at(state, edgeFacelet);
  });
}

// ─── Building each step's facts ──────────────────────────────────────────────────────

/** `start` is the cube before the cross, reached by face turns alone. */
export function crossFacts(
  start: CubeState,
  face: Face,
  frame: Frame,
  moves: readonly Move[],
): StepFact[] {
  const pieces = crossSlotsFor(face);
  // After each prefix of the moves, which cross edges are home.
  const homeAfter: boolean[][] = [];
  let state = start;
  for (let count = 0; count <= moves.length; count += 1) {
    if (count > 0) state = applyMove(state, at(moves, count - 1));
    const digits = edgeDigits(state);
    homeAfter.push(pieces.map((piece) => at(digits, piece) === piece * 2));
  }

  const edges = pieces.map((piece, i) => {
    const colour = [...at(EDGE_SLOTS, piece).name].find((f) => f !== face) as Face;
    let solvedAfter = moves.length;
    while (solvedAfter > 0 && at(at(homeAfter, solvedAfter - 1), i)) solvedAfter -= 1;
    return { colour, side: frame.heldPositionOf[colour], solvedAfter };
  });

  return [
    {
      kind: 'cross-summary',
      colour: face,
      moveCount: moves.length,
      optimalCount: crossDistance(start, face),
      edges,
    },
  ];
}

/** What {@link pairFacts} needs about one F2L step. */
export interface PairStepInput {
  /** The cube when the step begins, reached by face turns alone. */
  readonly before: CubeState;
  readonly crossColour: Face;
  /** The grip before the step's rotation: the one the choice is made in. */
  readonly previous: Frame;
  /** The chosen search, which carries the slot, rotation, grip and moves. */
  readonly chosen: FoundSearch;
  /** Every search made for this step, the chosen one included. */
  readonly searches: readonly SlotSearch[];
  /** Pairs solved before the step. */
  readonly solvedBefore: readonly Slot[];
  readonly alsoSolved: readonly Slot[];
}

export function pairFacts(input: PairStepInput): StepFact[] {
  const { before, crossColour, previous, chosen, searches, solvedBefore, alsoSolved } = input;
  const { slot, frame, moves } = chosen;

  const others = searches
    .filter((search) => search.slot !== slot)
    .map((search): OtherSlot => {
      const ref = slotRef(search.slot, previous);
      return search.status === 'found'
        ? { slot: ref, status: 'found', insertLength: search.moves.length }
        : { slot: ref, status: 'failed', limit: search.failure };
    });

  // The last point at which the pair was not joined; it is joined from the next move on.
  let joinedAfter = 0;
  let state = before;
  for (const [index, move] of moves.entries()) {
    if (!isPairJoined(state, slot)) joinedAfter = index + 1;
    state = applyMove(state, move);
  }
  if (!isPairJoined(state, slot)) throw new Error('The insert ended without the pair joined');

  const facts: StepFact[] = [
    {
      kind: 'pair-choice',
      chosen: slotRef(slot, previous),
      rotation: chosen.added,
      insertLength: moves.length,
      others,
    },
    {
      kind: 'pair-located',
      corner: locateCorner(before, slot, crossColour, frame),
      edge: locateEdge(before, slot, frame),
    },
    { kind: 'pair-joined', joinedAfter, moveCount: moves.length },
    { kind: 'preserved', slots: solvedBefore.map((s) => slotRef(s, frame)) },
  ];
  if (alsoSolved.length > 0) {
    facts.push({ kind: 'also-solved', slots: alsoSolved.map((s) => slotRef(s, frame)) });
  }
  return facts;
}
