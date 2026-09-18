import { at, MOVE_PERMUTATIONS } from './permutations.js';
import {
  FACELET_COUNT,
  FACELETS_PER_FACE,
  FACES,
  type CubeState,
  type Face,
  type Move,
} from './types.js';

/** A cube with every sticker on its home face. */
export function createSolvedCube(): CubeState {
  return FACES.flatMap((face) => Array.from<Face>({ length: FACELETS_PER_FACE }).fill(face));
}

/**
 * Apply one move, returning a new state.
 *
 * The input is never modified. Solve replay, undo and React rendering all depend on
 * old states staying valid, and copying 54 entries is not worth optimising away.
 */
export function applyMove(state: CubeState, move: Move): CubeState {
  const permutation = MOVE_PERMUTATIONS[move];
  return permutation.map((source) => at(state, source));
}

/** Apply a sequence of moves in order, left to right. */
export function applyMoves(state: CubeState, moves: readonly Move[]): CubeState {
  return moves.reduce<CubeState>(applyMove, state);
}

/**
 * True when every sticker is back on its home face.
 *
 * This compares against the solved state rather than checking centres, because a
 * cube can be solved but rotated as a whole — and for a timer that state is not
 * "solved". Whole-cube rotations are not part of the move set, so this cannot
 * produce a false negative here.
 */
export function isSolved(state: CubeState): boolean {
  const solved = createSolvedCube();
  return state.every((facelet, index) => facelet === at(solved, index));
}

/** Serialise to the 54-character facelet string used by cubing.js and by solvers. */
export function toFaceletString(state: CubeState): string {
  return state.join('');
}

/**
 * Parse a 54-character facelet string.
 *
 * This is the boundary where untrusted input enters the engine — a stored scramble, an
 * API payload — so it validates length, characters, and that each face appears exactly
 * nine times. It deliberately does *not* check that the position is physically solvable;
 * that needs piece-level analysis and is not required yet.
 */
export function fromFaceletString(input: string): CubeState {
  if (input.length !== FACELET_COUNT) {
    throw new TypeError(`Expected ${FACELET_COUNT} facelets, received ${input.length}`);
  }

  const state: Face[] = [];
  const counts = new Map<Face, number>();

  for (const [index, character] of [...input].entries()) {
    const face = FACES.find((candidate) => candidate === character);
    if (face === undefined) {
      throw new TypeError(`Invalid facelet '${character}' at index ${index}`);
    }
    state.push(face);
    counts.set(face, (counts.get(face) ?? 0) + 1);
  }

  for (const face of FACES) {
    const count = counts.get(face) ?? 0;
    if (count !== FACELETS_PER_FACE) {
      throw new TypeError(`Expected ${FACELETS_PER_FACE} '${face}' facelets, found ${count}`);
    }
  }

  return state;
}
