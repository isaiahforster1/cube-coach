import { applyMoves, createSolvedCube } from '../cube/cube.js';
import { at } from '../cube/permutations.js';
import { FACES, TURNS, type Face, type Move } from '../cube/types.js';
import { EDGE_MOVES, EDGE_SLOTS, readEdges } from './edges.js';

/**
 * How many moves an optimal cross takes, for a given scramble and colour.
 *
 * This is the measurement the coaching is meant to rest on. A solve time says nothing
 * about why it was what it was — the same time on an easy scramble and a hard one mean
 * completely different things. Knowing objectively how hard each scramble's cross was
 * turns a list of times into something diagnosable: whether a cuber is genuinely colour
 * neutral, or whether their times fall apart once the cross needs more than six moves.
 *
 * It is computed exactly, by search, not estimated. The cross is four edges, so the
 * entire problem is small enough to solve completely.
 */

const ALL_MOVES: Move[] = FACES.flatMap((face) => TURNS.map((turn) => `${face}${turn}` as Move));

/** The four edge slots that make up the cross on a given face. */
function crossSlotsFor(face: Face): number[] {
  return EDGE_SLOTS.map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.name.includes(face))
    .map(({ index }) => index);
}

/**
 * Pack the four cross pieces into a single integer.
 *
 * Each piece contributes its slot (0-11) and orientation (0-1) — 24 values, so four
 * pieces fit as base-24 digits. That allows 331,776 indices, more than the ~190,000
 * actually reachable, but dense enough to use a flat array and keep the search loop to
 * plain integer arithmetic.
 */
const RADIX = 24;
const TABLE_SIZE = RADIX ** 4;
const UNVISITED = 255;

function encode(slots: readonly number[], orientations: readonly number[]): number {
  let index = 0;
  for (let piece = 3; piece >= 0; piece -= 1) {
    index = index * RADIX + (at(slots, piece) * 2 + at(orientations, piece));
  }
  return index;
}

/**
 * How each move transforms one packed digit.
 *
 * Precomputing this 24-entry map per move turns the inner loop into four lookups and
 * some arithmetic, allocating nothing. The first version rebuilt arrays for every state
 * and took over five seconds to build one table; this takes a fraction of that, for the
 * same answer.
 */
const DIGIT_MAPS: Record<Move, Uint8Array> = (() => {
  const maps: Partial<Record<Move, Uint8Array>> = {};

  for (const move of ALL_MOVES) {
    const effect = EDGE_MOVES[move];
    const map = new Uint8Array(RADIX);

    for (let digit = 0; digit < RADIX; digit += 1) {
      const slot = digit >> 1;
      const orientation = digit & 1;
      map[digit] = at(effect.destination, slot) * 2 + (orientation ^ at(effect.flip, slot));
    }

    maps[move] = map;
  }

  return maps as Record<Move, Uint8Array>;
})();

/**
 * Distances from the solved cross to every reachable arrangement, by breadth-first
 * search.
 *
 * Searched outwards from solved once, rather than from each scramble towards solved.
 * Every move has an inverse, so distance is symmetric — one search answers every future
 * question by lookup instead of repeating work per scramble.
 *
 * Built lazily per face and cached, because computing all six up front would cost time
 * for questions nobody has asked.
 */
const distanceTables = new Map<Face, Uint8Array>();

function distanceTableFor(face: Face): Uint8Array {
  const cached = distanceTables.get(face);
  if (cached !== undefined) return cached;

  const table = new Uint8Array(TABLE_SIZE).fill(UNVISITED);
  const start = encode(crossSlotsFor(face), [0, 0, 0, 0]);
  table[start] = 0;

  const queue = new Int32Array(TABLE_SIZE);
  queue[0] = start;
  let head = 0;
  let tail = 1;

  while (head < tail) {
    const index = queue[head] ?? 0;
    head += 1;
    const distance = (table[index] ?? 0) + 1;

    const d0 = index % RADIX;
    const d1 = Math.floor(index / RADIX) % RADIX;
    const d2 = Math.floor(index / RADIX ** 2) % RADIX;
    const d3 = Math.floor(index / RADIX ** 3) % RADIX;

    for (const move of ALL_MOVES) {
      const map = DIGIT_MAPS[move];
      const next =
        (map[d0] ?? 0) +
        (map[d1] ?? 0) * RADIX +
        (map[d2] ?? 0) * RADIX ** 2 +
        (map[d3] ?? 0) * RADIX ** 3;

      if (table[next] !== UNVISITED) continue;

      table[next] = distance;
      queue[tail] = next;
      tail += 1;
    }
  }

  distanceTables.set(face, table);
  return table;
}

/**
 * The minimum number of moves to solve the cross on `face` after `scramble`.
 *
 * Returns 0 when the cross is already solved, which happens occasionally and is itself
 * worth noticing.
 */
export function crossDifficulty(scramble: readonly Move[], face: Face): number {
  const placements = readEdges(applyMoves(createSolvedCube(), scramble));

  // Where each cross piece currently sits, and which way round it is.
  const slots = crossSlotsFor(face).map((home) =>
    placements.findIndex((placement) => placement.piece === home),
  );
  const orientations = slots.map((slot) => at(placements, slot).orientation);

  const distance = distanceTableFor(face)[encode(slots, orientations)];
  if (distance === undefined || distance === UNVISITED) {
    throw new Error('Reached a cross arrangement the search never found, which is impossible');
  }

  return distance;
}

/**
 * Cross difficulty on every face, for judging colour neutrality.
 *
 * A cuber who always solves one colour is at the mercy of whichever cross that colour
 * happens to have. Someone genuinely colour neutral takes the easiest of the six, which
 * is usually two or three moves shorter.
 */
export function crossDifficultyByFace(scramble: readonly Move[]): Record<Face, number> {
  const result: Partial<Record<Face, number>> = {};
  for (const face of FACES) {
    result[face] = crossDifficulty(scramble, face);
  }
  return result as Record<Face, number>;
}
