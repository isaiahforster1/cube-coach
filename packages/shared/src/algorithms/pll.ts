import { parseAlgorithm } from '../cube/notation.js';
import type { CubeState, Move } from '../cube/types.js';
import { caseShape, lastLayerPermutation, positionSolvedBy } from './last-layer.js';

/**
 * PLL — the last step of the usual beginner-to-intermediate method, where the top face
 * is already finished and the pieces only need moving into place.
 *
 * There are exactly 21 of these, and that is not a number anyone had to look up: with
 * everything below the top layer solved and the top face finished, the only freedom left
 * is how four corners and four edges are arranged, and the engine counts the classes
 * itself. See {@link everyLastLayerCase}. A test asserts this library covers all of them.
 */

/** What a case moves. Recognition really is this: which kind of thing is out of place. */
export type PllFamily = 'corners' | 'edges' | 'both';

export interface PllCase {
  /** The usual speedcubing label, e.g. `Ua`. */
  readonly id: string;
  /** A description of what actually happens, computed rather than claimed. */
  readonly name: string;
  readonly family: PllFamily;
  /** An algorithm that solves this case, written in the six face turns. */
  readonly algorithm: string;
  /** Where the algorithm came from, when that is worth knowing. */
  readonly source?: string;
}

/**
 * The library.
 *
 * Every algorithm here is written in plain face turns. The engine has no wide turns,
 * slice moves or whole-cube rotations (ADR-0003), so the more elegant published
 * algorithms — which lean on `M` and `r` heavily — cannot be expressed. What is here is
 * checkable, which matters more: each algorithm is run by the engine and must leave the
 * first two layers solved and the top face finished, and the 21 must land on 21 distinct
 * cases covering every possibility.
 *
 * Two of them were not written from memory at all. See the notes on E and Z.
 */
export const PLL_CASES: readonly PllCase[] = [
  {
    id: 'Aa',
    name: 'Three corners cycle, edges already done',
    family: 'corners',
    algorithm: "R' F R' B2 R F' R' B2 R2",
  },
  {
    id: 'Ab',
    name: 'Three corners cycle the other way',
    family: 'corners',
    algorithm: "R2 B2 R F R' B2 R F' R",
  },
  {
    id: 'E',
    name: 'Both pairs of neighbouring corners swap',
    family: 'corners',
    algorithm: "F2 U' F2 U2 R2 U R2 U F2 R2 U2 R2 U F2 U2",
    source:
      'Found by searching, not recalled. Every E perm worth memorising uses whole-cube ' +
      'rotations, which this engine does not have, so the engine was asked for one built ' +
      'from face turns instead.',
  },
  {
    id: 'F',
    name: 'Two corners and two edges swap',
    family: 'both',
    algorithm: "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R",
  },
  {
    id: 'Ga',
    name: 'Corners and edges both cycle',
    family: 'both',
    algorithm: "R2 U R' U R' U' R U' R2 U' D R' U R D'",
  },
  {
    id: 'Gb',
    name: 'Corners and edges both cycle',
    family: 'both',
    algorithm: "R' U' R U D' R2 U R' U R U' R U' R2 D",
  },
  {
    id: 'Gc',
    name: 'Corners and edges both cycle',
    family: 'both',
    algorithm: "R2 U' R U' R U R' U R2 U D' R U' R' D",
  },
  {
    id: 'Gd',
    name: 'Corners and edges both cycle',
    family: 'both',
    algorithm: "R U R' U' D R2 U' R U' R' U R' U R2 D'",
  },
  {
    id: 'H',
    name: 'Both pairs of opposite edges swap',
    family: 'edges',
    algorithm: 'R2 U2 R U2 R2 U2 R2 U2 R U2 R2',
  },
  {
    id: 'Ja',
    name: 'Two corners and two edges swap',
    family: 'both',
    algorithm: "R' U L' U2 R U' R' U2 R L",
  },
  {
    id: 'Jb',
    name: 'Two corners and two edges swap',
    family: 'both',
    algorithm: "R U R' F' R U R' U' R' F R2 U' R' U'",
  },
  {
    id: 'Na',
    name: 'Two opposite pairs swap',
    family: 'both',
    algorithm: "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'",
  },
  {
    id: 'Nb',
    name: 'Two opposite pairs swap',
    family: 'both',
    algorithm: "R' U R U' R' F' U' F R U R' F R' F' R U' R",
  },
  {
    id: 'Ra',
    name: 'Two corners and two edges swap',
    family: 'both',
    algorithm: "R U' R' U' R U R D R' U' R D' R' U2 R' U'",
  },
  {
    id: 'Rb',
    name: 'Two corners and two edges swap',
    family: 'both',
    algorithm: "R2 F R U R U' R' F' R U2 R' U2 R",
  },
  {
    id: 'T',
    name: 'Two corners and two edges swap',
    family: 'both',
    algorithm: "R U R' U' R' F R2 U' R' U' R U R' F'",
  },
  {
    id: 'Ua',
    name: 'Three edges cycle, corners already done',
    family: 'edges',
    algorithm: "R U' R U R U R U' R' U' R2",
  },
  {
    id: 'Ub',
    name: 'Three edges cycle the other way',
    family: 'edges',
    algorithm: "R2 U R U R' U' R' U' R' U R'",
  },
  {
    id: 'V',
    name: 'Two corners and two edges swap',
    family: 'both',
    algorithm: "R' U R' U' R D' R' D R' U D' R2 U' R2 D R2",
  },
  {
    id: 'Y',
    name: 'Two corners and two edges swap',
    family: 'both',
    algorithm: "F R U' R' U' R U R' F' R U R' U' R' F R F'",
  },
  {
    id: 'Z',
    name: 'Both pairs of neighbouring edges swap',
    family: 'edges',
    algorithm: "R2 U2 F2 U F2 R2 F2 R2 F2 R2 U' F2 U2 R2",
    source:
      'Found by searching. The algorithm usually taught is built from slice moves, which ' +
      'this engine does not have.',
  },
];

/** The moves of a case, parsed. */
export function movesOf(algorithmCase: PllCase): Move[] {
  return parseAlgorithm(algorithmCase.algorithm);
}

/**
 * The cube as you would find it: the position this case's algorithm solves.
 *
 * Derived from the algorithm rather than stored, so the picture and the moves cannot
 * disagree. Nobody has to draw a sticker diagram, and a mistyped algorithm shows up as a
 * wrong picture *and* a failing test rather than as a quietly wrong lesson.
 */
export function positionOf(algorithmCase: PllCase): CubeState {
  return positionSolvedBy(movesOf(algorithmCase));
}

/**
 * Which family a position belongs to, worked out from the cube rather than the label.
 *
 * The `family` recorded on each case is what the library *claims*; this is what is
 * actually true. A test compares the two, so a case cannot be filed under the wrong
 * heading without something failing.
 */
export function familyOf(state: CubeState): PllFamily {
  const shape = caseShape(lastLayerPermutation(state));

  if (shape.edges.length === 0) return 'corners';
  if (shape.corners.length === 0) return 'edges';
  return 'both';
}
