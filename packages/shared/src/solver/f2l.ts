/**
 * The F2L step of the solver (ADR-0021 §4).
 *
 * For each unsolved slot, choose the `y` that brings it to front right, then search for
 * the shortest sequence over `U R F L` as held that solves that pair and leaves the cross
 * and every solved pair intact at the end. Take the shortest of those inserts, apply it,
 * and repeat. Greedy, not a globally shortest F2L: see the ADR for why.
 *
 * The search runs in the fixed frame, on the state as scrambled, with the cross on
 * whichever face the {@link CrossStep} chose. Nothing is relabelled. The frame decides
 * only two things: which fixed faces are in the move set, and the order moves are tried
 * in. Turning it into what the person does is left to {@link present}, as for the cross.
 */
import { applyMoves } from '../cube/cube.js';
import { at } from '../cube/permutations.js';
import {
  FACES,
  type CubeState,
  type Face,
  type Move,
  type Rotation,
  type Token,
} from '../cube/types.js';
import { CORNER_SLOTS } from '../analysis/corners.js';
import { crossDistance, crossDistanceTable, crossSlotsFor } from '../analysis/cross.js';
import { EDGE_SLOTS } from '../analysis/edges.js';
import { heldCost, movesByHeldCost, type CrossStep } from './cross.js';
import { pairFacts, type StepFact } from './facts.js';
import { frameOf, heldFaceOf, present, setupRotationFor, type Frame } from './frame.js';
import {
  ALL_MOVES,
  byte,
  CORNER_DIGIT,
  cornerDigits,
  DIGITS,
  EDGE_DIGIT,
  edgeDigits,
  FACE_OF_MOVE,
} from './pieces.js';

// ─── Slots ───────────────────────────────────────────────────────────────────────────

/** One F2L slot: a corner on the cross face and the middle-layer edge beside it. */
export interface Slot {
  /** The edge's slot name in fixed labels, which are also its colours: `FR` is green-red. */
  readonly name: string;
  /** Index into `EDGE_SLOTS` of the edge's home. */
  readonly edge: number;
  /** Index into `CORNER_SLOTS` of the corner's home. */
  readonly corner: number;
  /** The two side faces the slot sits between. */
  readonly sides: readonly [Face, Face];
}

/**
 * The four slots for a cross on `face`, derived from the piece tables rather than listed:
 * each corner that touches `face`, paired with the edge between its other two faces.
 */
export function slotsFor(face: Face): Slot[] {
  return CORNER_SLOTS.flatMap((corner, cornerIndex) => {
    if (!corner.name.includes(face)) return [];
    const sides = [...corner.name].filter((f) => f !== face) as [Face, Face];
    const edge = EDGE_SLOTS.findIndex(
      ({ name }) => name.includes(sides[0]) && name.includes(sides[1]),
    );
    return [{ name: at(EDGE_SLOTS, edge).name, edge, corner: cornerIndex, sides }];
  });
}

/** Tried in this order, so a slot already at front right needs no rotation. */
const Y_TURNS: readonly (readonly Rotation[])[] = [[], ['y'], ["y'"], ['y2']];

/**
 * The `y` that brings `slot` to front right, starting from `from`, and the frame it gives.
 * With the cross on the bottom, the four `y` turns carry the slot round all four sides,
 * so exactly one of them works.
 */
export function holdAtFrontRight(
  slot: Slot,
  from: Frame,
): { readonly added: readonly Rotation[]; readonly frame: Frame } {
  for (const added of Y_TURNS) {
    const frame = added.length === 0 ? from : frameOf([...from.rotations, ...added]);
    const held = slot.sides.map((side) => frame.heldPositionOf[side]);
    if (held.includes('front') && held.includes('right')) return { added, frame };
  }
  throw new Error(`No y brings ${slot.name} to front right, so the cross is not on the bottom`);
}

/**
 * The F2L move set for a frame, as indices into `ALL_MOVES`: every move except held `D`
 * and held `B`, cheapest as held first. The order is the tie-break between equally short
 * inserts, the same one the cross uses.
 */
function moveSetFor(frame: Frame): number[] {
  return movesByHeldCost(frame)
    .filter((move) => !['bottom', 'back'].includes(heldFaceOf(move, frame)))
    .map((move) => ALL_MOVES.indexOf(move));
}

// ─── Pair tables ─────────────────────────────────────────────────────────────────────

const UNVISITED = 255;

/** Keyed by the two excluded faces (cross face, held back) and the pair's two pieces. */
const pairTables = new Map<string, Uint8Array>();

/**
 * Distance from each (corner digit, edge digit) to `pair` solved, using only `moves`.
 * 576 entries, breadth-first from solved, the same method as the cross table. Built
 * lazily and cached; there are at most 96 (6 cross faces × 4 held backs × 4 pairs).
 */
function pairTable(pair: Slot, frame: Frame, moves: readonly number[]): Uint8Array {
  const key = `${frame.fixedFaceAt.bottom}${frame.fixedFaceAt.back}:${pair.corner}:${pair.edge}`;
  const cached = pairTables.get(key);
  if (cached !== undefined) return cached;

  const table = new Uint8Array(DIGITS * DIGITS).fill(UNVISITED);
  const start = pair.corner * 3 * DIGITS + pair.edge * 2;
  table[start] = 0;
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const index = at(queue, head);
    const corner = Math.floor(index / DIGITS);
    const edge = index % DIGITS;
    for (const m of moves) {
      const next =
        byte(CORNER_DIGIT, m * DIGITS + corner) * DIGITS + byte(EDGE_DIGIT, m * DIGITS + edge);
      if (table[next] !== UNVISITED) continue;
      table[next] = byte(table, index) + 1;
      queue.push(next);
    }
  }

  pairTables.set(key, table);
  return table;
}

/**
 * Build every table an F2L on `face` can use, so the first solve does not pay for them.
 * Optional: the search builds anything missing on demand.
 */
export function prepareF2L(face: Face): void {
  crossDistanceTable(face);
  const base = frameOf(setupRotationFor(face));
  for (const slot of slotsFor(face)) {
    const { frame } = holdAtFrontRight(slot, base);
    const moves = moveSetFor(frame);
    for (const pair of slotsFor(face)) pairTable(pair, frame, moves);
  }
}

// ─── One slot: IDA* ──────────────────────────────────────────────────────────────────

export interface SearchLimits {
  /** Longest insert searched, in HTM. Beyond this the search fails. */
  readonly maxDepth: number;
  /** Positions one slot's search may visit, across all IDA* iterations, before failing. */
  readonly maxNodes: number;
}

/** ADR-0021 §4: 12 moves and 2,000,000 positions. Reaching either fails the step. */
export const F2L_LIMITS: SearchLimits = { maxDepth: 12, maxNodes: 2_000_000 };

interface SearchCommon {
  readonly slot: Slot;
  /** The rotation from the frame before the step to this slot's frame. Often empty. */
  readonly added: readonly Rotation[];
  /** How the cube is held for this insert: the slot at front right. */
  readonly frame: Frame;
  /** Positions visited, across every IDA* iteration. */
  readonly nodes: number;
}

export type FoundSearch = SearchCommon & {
  readonly status: 'found';
  /** The shortest insert, in the fixed frame. */
  readonly moves: readonly Move[];
};

export type FailedSearch = SearchCommon & {
  readonly status: 'failed';
  /** Which limit was reached. */
  readonly failure: 'depth' | 'nodes';
};

export type SlotSearch = FoundSearch | FailedSearch;

const OPPOSITE: Record<Face, Face> = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

/**
 * `MAY_FOLLOW[(last + 1) * 6 + next]` is 1 when a move on face `next` may follow one on
 * face `last` (`last` = -1 at the start). Two turns of one face are never searched, since
 * they are one turn. Opposite faces commute, so only one order of each is: `R L`, not `L R`.
 */
const MAY_FOLLOW = new Uint8Array((FACES.length + 1) * FACES.length);
for (let last = -1; last < FACES.length; last += 1) {
  for (const [next, face] of FACES.entries()) {
    const same = next === last;
    const redundantOrder = last >= 0 && OPPOSITE[at(FACES, last)] === face && next < last;
    MAY_FOLLOW[(last + 1) * FACES.length + next] = same || redundantOrder ? 0 : 1;
  }
}

/**
 * The shortest insert for `slot` from `state`, keeping the cross and `solved` intact at
 * the end. Among equally short inserts, the first found in cheap-first move order wins.
 *
 * `state` must be reached by face turns alone. The tracked pieces live in flat typed
 * arrays, one row per depth, so each step of the search is a few table lookups.
 */
export function searchSlot(
  state: CubeState,
  face: Face,
  slot: Slot,
  solved: readonly Slot[],
  from: Frame,
  limits: SearchLimits = F2L_LIMITS,
): SlotSearch {
  const { added, frame } = holdAtFrontRight(slot, from);
  const moves = moveSetFor(frame);
  const crossTable = crossDistanceTable(face);
  const targetTable = pairTable(slot, frame, moves);

  // Tracked pieces: the four cross edges first, in the order the cross table packs them,
  // then the target pair, then each pair that must be preserved.
  const pairs = [slot, ...solved];
  const edgePieces = [...crossSlotsFor(face), ...pairs.map((p) => p.edge)];
  const cornerPieces = pairs.map((p) => p.corner);
  const E = edgePieces.length;
  const C = cornerPieces.length;
  const edgeGoal = edgePieces.map((piece) => piece * 2);
  const cornerGoal = cornerPieces.map((piece) => piece * 3);

  const edgeStack = new Uint8Array((limits.maxDepth + 1) * E);
  const cornerStack = new Uint8Array((limits.maxDepth + 1) * C);
  const allEdges = edgeDigits(state);
  const allCorners = cornerDigits(state);
  edgePieces.forEach((piece, i) => (edgeStack[i] = at(allEdges, piece)));
  cornerPieces.forEach((piece, i) => (cornerStack[i] = at(allCorners, piece)));

  const path: number[] = [];
  let nodes = 0;
  let outOfNodes = false;

  // Hot path, run up to millions of times per search. Two things keep it fast, and
  // together they took it from about 155 ns to about 37 ns per position:
  //
  // - The tables are copied into locals. An imported binding can compile to a property
  //   read on a module object (Vitest's transform does exactly that), on every use.
  // - Every index is in range by construction (digits are below 24, which the digit-table
  //   test checks against the sticker model), so `?? 0` is only there for the type
  //   checker. The bounds-checked `byte`, used when building tables, is a call and a branch.
  const edgeDigit = EDGE_DIGIT;
  const cornerDigit = CORNER_DIGIT;
  const faceOfMove = FACE_OF_MOVE;
  const mayFollow = MAY_FOLLOW;
  const faceCount = FACES.length;

  /** The larger of the cross distance and the target pair's distance: both admissible. */
  function lowerBound(depth: number): number {
    const e = depth * E;
    const cross =
      crossTable[
        (edgeStack[e] ?? 0) +
          (edgeStack[e + 1] ?? 0) * 24 +
          (edgeStack[e + 2] ?? 0) * 576 +
          (edgeStack[e + 3] ?? 0) * 13824
      ] ?? 0;
    const pair = targetTable[(cornerStack[depth * C] ?? 0) * 24 + (edgeStack[e + 4] ?? 0)] ?? 0;
    return cross > pair ? cross : pair;
  }

  function isGoal(depth: number): boolean {
    for (let i = 0; i < E; i += 1) if (edgeStack[depth * E + i] !== edgeGoal[i]) return false;
    for (let i = 0; i < C; i += 1) if (cornerStack[depth * C + i] !== cornerGoal[i]) return false;
    return true;
  }

  /** True when a solution of exactly `limit` moves has been found; it is left in `path`. */
  function dfs(depth: number, limit: number, lastFace: number): boolean {
    nodes += 1;
    if (nodes > limits.maxNodes) {
      outOfNodes = true;
      return false;
    }
    if (depth + lowerBound(depth) > limit) return false;
    if (depth === limit) return isGoal(depth);

    for (const m of moves) {
      const moveFace = faceOfMove[m] ?? 0;
      if (mayFollow[(lastFace + 1) * faceCount + moveFace] === 0) continue;

      const from = depth * E;
      for (let i = 0; i < E; i += 1) {
        edgeStack[from + E + i] = edgeDigit[m * 24 + (edgeStack[from + i] ?? 0)] ?? 0;
      }
      const cFrom = depth * C;
      for (let i = 0; i < C; i += 1) {
        cornerStack[cFrom + C + i] = cornerDigit[m * 24 + (cornerStack[cFrom + i] ?? 0)] ?? 0;
      }

      path.push(m);
      if (dfs(depth + 1, limit, moveFace)) return true;
      path.pop();
      if (outOfNodes) return false;
    }
    return false;
  }

  const common = { slot, added, frame };
  for (let limit = lowerBound(0); limit <= limits.maxDepth; limit += 1) {
    if (dfs(0, limit, -1)) {
      return { ...common, nodes, status: 'found', moves: path.map((m) => at(ALL_MOVES, m)) };
    }
    if (outOfNodes) return { ...common, nodes, status: 'failed', failure: 'nodes' };
  }
  return { ...common, nodes, status: 'failed', failure: 'depth' };
}

// ─── Greedy F2L ──────────────────────────────────────────────────────────────────────

/** How dear an insert is to perform, as held: the sum of its moves' {@link heldCost}. */
export function insertCost(search: FoundSearch): number {
  return search.moves.reduce((sum, move) => sum + heldCost(move, search.frame), 0);
}

/**
 * The insert to perform next (ADR-0021 §4): the shortest; among those, one that needs no
 * new rotation; then the cheapest as held; then the first slot in {@link slotsFor} order.
 */
export function chooseInsert(searches: readonly SlotSearch[]): FoundSearch | undefined {
  let best: FoundSearch | undefined;
  for (const search of searches) {
    if (search.status !== 'found') continue;
    if (best === undefined || compareInserts(search, best) < 0) best = search;
  }
  return best;
}

function compareInserts(a: FoundSearch, b: FoundSearch): number {
  return (
    a.moves.length - b.moves.length ||
    a.added.length - b.added.length ||
    insertCost(a) - insertCost(b)
  );
}

export interface PairStep {
  readonly slot: Slot;
  /** The rotation shown before the moves. Empty when the slot was already at front right. */
  readonly added: readonly Rotation[];
  /** How the cube is held for this step and, until the next rotation, afterwards. */
  readonly frame: Frame;
  /** The insert in the fixed frame. What the solver reasons about. */
  readonly moves: readonly Move[];
  /** The rotation, then the moves as held. What the person is shown. */
  readonly tokens: readonly Token[];
  /** Other pairs this insert happened to solve, which therefore get no step of their own. */
  readonly alsoSolved: readonly Slot[];
  /** Every slot searched before this step, the chosen one included: why it was chosen. */
  readonly searches: readonly SlotSearch[];
  /**
   * What an explanation of this step may say (ADR-0021 §6): `pair-choice`, `pair-located`,
   * `pair-joined` and `preserved`, then `also-solved` when the insert solved other pairs.
   */
  readonly facts: readonly StepFact[];
}

interface F2LCommon {
  /** Pairs the cross left solved, which get no step. */
  readonly alreadySolved: readonly Slot[];
  /** The pairs solved, in order. */
  readonly steps: readonly PairStep[];
  /** How the cube is held after the last step. */
  readonly frame: Frame;
}

/**
 * F2L either finishes or fails loudly (ADR-0021 §4). A failure keeps the steps that did
 * succeed and the searches that all failed, so the case can be turned into a fixture.
 */
export type F2LResult =
  | (F2LCommon & { readonly status: 'solved' })
  | (F2LCommon & { readonly status: 'failed'; readonly searches: readonly FailedSearch[] });

function isPairHome(state: CubeState, slot: Slot): boolean {
  return (
    at(edgeDigits(state), slot.edge) === slot.edge * 2 &&
    at(cornerDigits(state), slot.corner) === slot.corner * 3
  );
}

/**
 * Greedy F2L after `cross`, on the cube `scrambled` was before the cross.
 *
 * `scrambled` is reached by face turns only, centres at home, as for {@link solveCross}.
 * The cross face and starting frame come from the cross step, so any of the six crosses
 * goes through this same code.
 */
export function solveF2L(
  scrambled: CubeState,
  cross: CrossStep,
  limits: SearchLimits = F2L_LIMITS,
): F2LResult {
  let state = applyMoves(scrambled, cross.moves);
  if (crossDistance(state, cross.face) !== 0) {
    throw new Error('The cross step does not solve the cross on this cube');
  }

  const slots = slotsFor(cross.face);
  const solved = slots.filter((slot) => isPairHome(state, slot));
  const alreadySolved = [...solved];
  const steps: PairStep[] = [];
  let frame = cross.frame;

  while (solved.length < slots.length) {
    const searches = slots
      .filter((slot) => !solved.includes(slot))
      .map((slot) => searchSlot(state, cross.face, slot, solved, frame, limits));
    const best = chooseInsert(searches);
    if (best === undefined) {
      return {
        status: 'failed',
        alreadySolved,
        steps,
        frame,
        searches: searches.filter((s): s is FailedSearch => s.status === 'failed'),
      };
    }

    const before = state;
    const solvedBefore = [...solved];
    const previous = frame;
    state = applyMoves(state, best.moves);
    solved.push(best.slot);
    const alsoSolved = slots.filter((slot) => !solved.includes(slot) && isPairHome(state, slot));
    solved.push(...alsoSolved);
    frame = best.frame;
    steps.push({
      slot: best.slot,
      added: best.added,
      frame,
      moves: best.moves,
      tokens: present(best.moves, best.added, frame),
      alsoSolved,
      searches,
      facts: pairFacts({
        before,
        crossColour: cross.face,
        previous,
        chosen: best,
        searches,
        solvedBefore,
        alsoSolved,
      }),
    });
  }

  return { status: 'solved', alreadySolved, steps, frame };
}
