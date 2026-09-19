import { readCorners } from '../analysis/corners.js';
import { readEdges } from '../analysis/edges.js';
import { applyMoves, createSolvedCube } from '../cube/cube.js';
import { invertAlgorithm } from '../cube/notation.js';
import { at } from '../cube/permutations.js';
import { FACELETS_PER_FACE, FACES, type CubeState, type Move } from '../cube/types.js';

/**
 * The last layer, as a permutation of four corners and four edges.
 *
 * A last-layer case is not an algorithm — it is a *position*, and many different
 * algorithms reach the same one. Describing cases as permutations rather than as move
 * sequences is what lets the engine check the library: an algorithm that has been typed
 * wrong produces the wrong permutation, or breaks the layers below, and says so.
 */

/**
 * The four corner slots of the last layer and the four edge slots, both listed in the
 * same rotational order around the U face.
 *
 * Matching the order matters: turning the whole cube a quarter turn shifts both lists by
 * exactly one, which is what makes {@link caseClassOf} a relabelling rather than a
 * special case per piece type.
 */
const LAST_LAYER_CORNERS = [0, 3, 2, 1] as const; // URF, UBR, ULB, UFL
const LAST_LAYER_EDGES = [0, 1, 2, 3] as const; // UF, UR, UB, UL

const LAST_LAYER_SIZE = 4;

/** Which last-layer piece sits in each last-layer slot. */
export interface LastLayerPermutation {
  /** `corners[slot]` is the home slot of the corner now in `slot`, both 0-3. */
  readonly corners: readonly number[];
  readonly edges: readonly number[];
}

export class NotALastLayerCaseError extends Error {
  constructor(reason: string) {
    super(`This position is not a last-layer case: ${reason}`);
    this.name = 'NotALastLayerCaseError';
  }
}

/** True when everything except the top layer is where it belongs. */
export function isFirstTwoLayersSolved(state: CubeState): boolean {
  const corners = readCorners(state);
  const edges = readEdges(state);

  const cornersBelow = corners.every(
    (placement, slot) =>
      LAST_LAYER_CORNERS.includes(slot as 0 | 1 | 2 | 3) ||
      (placement.piece === slot && placement.orientation === 0),
  );

  const edgesBelow = edges.every(
    (placement, slot) =>
      LAST_LAYER_EDGES.includes(slot as 0 | 1 | 2 | 3) ||
      (placement.piece === slot && placement.orientation === 0),
  );

  return cornersBelow && edgesBelow;
}

/** True when every sticker on the top face is a top-face sticker. */
export function isLastLayerOriented(state: CubeState): boolean {
  const top = FACES.indexOf('U') * FACELETS_PER_FACE;
  return Array.from({ length: FACELETS_PER_FACE }, (_, cell) => at(state, top + cell)).every(
    (sticker) => sticker === 'U',
  );
}

/**
 * Read the last layer's permutation.
 *
 * Throws rather than returning something approximate when the position is not a
 * last-layer case at all: a caller asking this question has already assumed the rest of
 * the cube is solved, and quietly answering anyway would hide the mistake.
 */
export function lastLayerPermutation(state: CubeState): LastLayerPermutation {
  if (!isFirstTwoLayersSolved(state)) {
    throw new NotALastLayerCaseError('the first two layers are not solved');
  }
  if (!isLastLayerOriented(state)) {
    throw new NotALastLayerCaseError('the top face is not finished');
  }

  const corners = readCorners(state);
  const edges = readEdges(state);

  const read = (slots: readonly number[], placements: { readonly piece: number }[]) =>
    slots.map((slot) => {
      const home = at(placements, slot).piece;
      const position = slots.indexOf(home);
      if (position === -1) {
        throw new NotALastLayerCaseError('a piece from below is in the top layer');
      }
      return position;
    });

  return {
    corners: read(LAST_LAYER_CORNERS, corners),
    edges: read(LAST_LAYER_EDGES, edges),
  };
}

/** How many pieces are not in their own slot. */
function misplacedCount(permutation: LastLayerPermutation): number {
  // Counted per list. Concatenating the two and comparing against one index range looks
  // tidier and quietly calls every edge misplaced, because the edges then start at 4.
  const wrong = (pieces: readonly number[]) =>
    pieces.filter((piece, slot) => piece !== slot).length;

  return wrong(permutation.corners) + wrong(permutation.edges);
}

/** True when nothing in the last layer needs to move. */
export function isLastLayerSolved(permutation: LastLayerPermutation): boolean {
  return misplacedCount(permutation) === 0;
}

/**
 * The cycles a permutation is made of, longest first, ignoring pieces that stay put.
 *
 * This is the shape of a case in the sense a cuber means it: "three corners go round and
 * the edges are fine" is a description you can act on, and it is computed rather than
 * written down, so it cannot disagree with the algorithm.
 */
export function cyclesOf(permutation: readonly number[]): number[][] {
  const seen = new Array<boolean>(permutation.length).fill(false);
  const cycles: number[][] = [];

  for (let start = 0; start < permutation.length; start += 1) {
    if (seen[start] === true) continue;

    const cycle: number[] = [];
    let index = start;
    while (seen[index] !== true) {
      seen[index] = true;
      cycle.push(index);
      index = at(permutation, index);
    }

    if (cycle.length > 1) cycles.push(cycle);
  }

  return cycles.sort((a, b) => b.length - a.length);
}

/** The cycle lengths, as a compact signature: `[3]`, `[2, 2]`, or `[]` for solved. */
export function cycleLengths(permutation: readonly number[]): number[] {
  return cyclesOf(permutation).map((cycle) => cycle.length);
}

/**
 * Turn the top layer: every piece moves on to the next slot, so the reading shifts
 * round. The piece labels are untouched — a piece's home does not move because you
 * turned the layer it is sitting in.
 */
function turnTopLayer(permutation: readonly number[]): number[] {
  const size = permutation.length;
  return Array.from({ length: size }, (_, slot) => at(permutation, (slot + size - 1) % size));
}

/** Rotate every slot index by one, as turning the whole cube would. */
function rotateWholeCube(permutation: readonly number[]): number[] {
  const size = permutation.length;
  return Array.from(
    { length: size },
    (_, slot) => (at(permutation, (slot + size - 1) % size) + 1) % size,
  );
}

/**
 * A canonical name for the *case*, as opposed to the exact position.
 *
 * Two positions are the same case when a cuber would use the same algorithm on them, and
 * that allows two freedoms:
 *
 * - **Adjusting the top layer first.** Turning U before you start does not change which
 *   case you are looking at, so a position and that position with U applied are the same.
 * - **Turning the whole cube.** A case rotated a quarter turn is the same case seen from
 *   a different side; you hold the cube differently and perform the same moves.
 *
 * Taking the smallest of all sixteen combinations gives every member of a class the same
 * string, which is what makes "are these two algorithms the same case?" and "is anything
 * missing?" answerable by the engine rather than by eye.
 */
export function caseClassOf(permutation: LastLayerPermutation): string {
  return [...variantsOf(permutation)].map(nameOf).sort()[0] as string;
}

function nameOf(permutation: LastLayerPermutation): string {
  return `${permutation.corners.join('')}|${permutation.edges.join('')}`;
}

/** The sixteen positions that are all the same case: four rotations by four adjustments. */
function variantsOf(permutation: LastLayerPermutation): LastLayerPermutation[] {
  const variants: LastLayerPermutation[] = [];

  let corners = [...permutation.corners];
  let edges = [...permutation.edges];

  for (let rotation = 0; rotation < LAST_LAYER_SIZE; rotation += 1) {
    let adjustedCorners = corners;
    let adjustedEdges = edges;

    for (let adjust = 0; adjust < LAST_LAYER_SIZE; adjust += 1) {
      variants.push({ corners: adjustedCorners, edges: adjustedEdges });
      adjustedCorners = turnTopLayer(adjustedCorners);
      adjustedEdges = turnTopLayer(adjustedEdges);
    }

    corners = rotateWholeCube(corners);
    edges = rotateWholeCube(edges);
  }

  return variants;
}

/**
 * The way a cuber would draw the case.
 *
 * A case has sixteen equivalent positions, and they do not all look alike: a U perm is
 * "three edges go round" only when you adjust the top layer so the corners are already
 * home. Turn it a quarter further and the same case reads as four corners and four edges
 * all out of place, which is true and useless.
 *
 * So the representative is the one with the fewest pieces out of place. That reproduces
 * every textbook description without any of them being written down.
 */
export function canonicalPosition(permutation: LastLayerPermutation): LastLayerPermutation {
  /**
   * Least disruption first: fewest pieces away from home, then the shortest longest
   * cycle.
   *
   * The second half is doing real work. A G perm has six pieces out of place however you
   * turn it, and one adjustment reads as three corners and three edges going round while
   * another reads as two corners swapping and four edges cycling. Both are true; the
   * first is how anyone describes it, and preferring the shorter longest cycle picks it
   * without that preference having to be written down per case.
   */
  const rank = (candidate: LastLayerPermutation): [number, number, string] => [
    misplacedCount(candidate),
    Math.max(0, ...cycleLengths(candidate.corners), ...cycleLengths(candidate.edges)),
    nameOf(candidate),
  ];

  return variantsOf(permutation).reduce((best, candidate) => {
    const [bestMisplaced, bestLongest, bestName] = rank(best);
    const [misplaced, longest, name] = rank(candidate);

    if (misplaced !== bestMisplaced) return misplaced < bestMisplaced ? candidate : best;
    if (longest !== bestLongest) return longest < bestLongest ? candidate : best;
    return name < bestName ? candidate : best;
  });
}

/** What actually moves in a case: `{ corners: [3], edges: [] }` is a corner three-cycle. */
export function caseShape(permutation: LastLayerPermutation): {
  corners: number[];
  edges: number[];
} {
  const canonical = canonicalPosition(permutation);
  return {
    corners: cycleLengths(canonical.corners),
    edges: cycleLengths(canonical.edges),
  };
}

/**
 * The position an algorithm solves.
 *
 * Running the algorithm forwards from a solved cube gives the position it *creates*,
 * which is the inverse of the one it fixes. Since the point is to show someone the case
 * they are looking at, the algorithm is run backwards.
 */
export function positionSolvedBy(moves: readonly Move[]): CubeState {
  return applyMoves(createSolvedCube(), invertAlgorithm(moves));
}

/** The case an algorithm solves. */
export function caseClassOfAlgorithm(moves: readonly Move[]): string {
  return caseClassOf(lastLayerPermutation(positionSolvedBy(moves)));
}

/**
 * Every last-layer permutation that can physically exist.
 *
 * With everything below solved and the top face finished, the only freedom left is how
 * the four corners and four edges are arranged — and those two permutations must have
 * the same parity, because every face turn is a four-cycle of each. That leaves 288
 * positions, which collapse into the familiar case list once the two freedoms in
 * {@link caseClassOf} are taken into account.
 *
 * Enumerated rather than listed, so "is the library complete?" has an answer that does
 * not depend on anyone remembering how many cases there are.
 */
export function everyLastLayerCase(): Set<string> {
  const arrangements = permutationsOf(LAST_LAYER_SIZE);
  const classes = new Set<string>();

  for (const corners of arrangements) {
    for (const edges of arrangements) {
      if (parityOf(corners) !== parityOf(edges)) continue;
      classes.add(caseClassOf({ corners, edges }));
    }
  }

  return classes;
}

function permutationsOf(size: number): number[][] {
  if (size === 0) return [[]];

  const smaller = permutationsOf(size - 1);
  return smaller.flatMap((permutation) =>
    Array.from({ length: size }, (_, position) => [
      ...permutation.slice(0, position),
      size - 1,
      ...permutation.slice(position),
    ]),
  );
}

function parityOf(permutation: readonly number[]): number {
  const seen = new Array<boolean>(permutation.length).fill(false);
  let swaps = 0;

  for (let start = 0; start < permutation.length; start += 1) {
    if (seen[start] === true) continue;

    let length = 0;
    let index = start;
    while (seen[index] !== true) {
      seen[index] = true;
      index = at(permutation, index);
      length += 1;
    }
    swaps += length - 1;
  }

  return swaps % 2;
}
