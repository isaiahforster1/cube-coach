/**
 * How the person is holding the cube, and translation of moves into that grip.
 *
 * The solver's state is only ever changed by face turns, so every centre stays at home
 * and every existing reader and table means what it says. Rotations are kept aside as a
 * {@link Frame} and used only when writing moves out. See ADR-0021 §1.
 */
import { applySequence, createSolvedCube } from '../cube/cube.js';
import { at } from '../cube/permutations.js';
import {
  AXES,
  FACELETS_PER_FACE,
  TURNS,
  type Face,
  type Move,
  type Rotation,
  type Token,
  type Turn,
} from '../cube/types.js';
import { HELD_POSITIONS, NOTATION_LETTER, type HeldPosition } from './held.js';

export interface Frame {
  /** The rotations applied since the scramble, in order. */
  readonly rotations: readonly Rotation[];
  /** For each held position, the fixed face whose centre is there now. */
  readonly fixedFaceAt: Readonly<Record<HeldPosition, Face>>;
  /** For each fixed face, the held position its centre is in now. The inverse of the above. */
  readonly heldPositionOf: Readonly<Record<Face, HeldPosition>>;
}

/**
 * The frame reached by applying `rotations` to a cube held the way it was scrambled.
 *
 * Derived, not typed in: rotate a solved cube and read the centres. The rotation tables
 * are already verified (ADR-0020), so there is no new hand-entered data here to get wrong.
 */
export function frameOf(rotations: readonly Rotation[]): Frame {
  const rotated = applySequence(createSolvedCube(), rotations);
  const fixedFaceAt: Partial<Record<HeldPosition, Face>> = {};
  const heldPositionOf: Partial<Record<Face, HeldPosition>> = {};

  for (const [index, held] of HELD_POSITIONS.entries()) {
    const fixed = at(rotated, index * FACELETS_PER_FACE + 4);
    fixedFaceAt[held] = fixed;
    heldPositionOf[fixed] = held;
  }

  return {
    rotations: [...rotations],
    fixedFaceAt: fixedFaceAt as Record<HeldPosition, Face>,
    heldPositionOf: heldPositionOf as Record<Face, HeldPosition>,
  };
}

/** The frame the scramble was applied in: nothing rotated. */
export const SCRAMBLE_FRAME: Frame = frameOf([]);

/**
 * A fixed-frame move as the person holding the cube in `frame` would perform it.
 *
 * Turning the held face `h` turns whichever layer has its centre on `h`, so the fixed move
 * on face `X` becomes the same turn on the held position of `X`'s centre. The turn suffix
 * is unchanged: every rotation is a proper rotation, never a mirror, so clockwise as seen
 * from outside stays clockwise.
 */
export function toHeld(move: Move, frame: Frame): Move {
  const turn = move.slice(1) as Turn;
  return `${NOTATION_LETTER[heldFaceOf(move, frame)]}${turn}`;
}

/** Where the layer a fixed-frame move turns is, as held. */
export function heldFaceOf(move: Move, frame: Frame): HeldPosition {
  return frame.heldPositionOf[move[0] as Face];
}

/** The rotations that change the frame, then the moves as held in the new frame. */
export function present(moves: readonly Move[], added: readonly Rotation[], after: Frame): Token[] {
  return [...added, ...moves.map((move) => toHeld(move, after))];
}

const ALL_ROTATIONS: readonly Rotation[] = AXES.flatMap((axis) =>
  TURNS.map((turn) => `${axis}${turn}` as Rotation),
);

/**
 * The shortest rotation that puts `face` on the bottom (ADR-0021 §2).
 *
 * Searched over the 24 orientations rather than written as a table, so a wrong entry
 * cannot exist. Every orientation is within two rotations, so the search is tiny. Among
 * equally short answers, one that keeps the front centre in place wins: a `U` cross gets
 * `z2`, which leaves front in front, not `x2`, which also swaps front and back. After that,
 * ties go to the first found, which is fixed by the order of {@link ALL_ROTATIONS}.
 */
export function setupRotationFor(face: Face): Rotation[] {
  let layer: Rotation[][] = [[]];

  for (let length = 0; length <= 2; length += 1) {
    const reaching = layer.filter((rotations) => frameOf(rotations).fixedFaceAt.bottom === face);
    const best =
      reaching.find((rotations) => frameOf(rotations).fixedFaceAt.front === 'F') ?? reaching[0];
    if (best !== undefined) return best;

    layer = layer.flatMap((rotations) => ALL_ROTATIONS.map((next) => [...rotations, next]));
  }

  throw new Error(`No rotation of two or fewer brings ${face} to the bottom, which is impossible`);
}
