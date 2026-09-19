import { FACELETS_PER_FACE, FACES, type Face, type Move } from '@cube-coach/shared';

/**
 * Where every sticker sits in space, so a single layer can be turned on screen.
 *
 * The engine models the cube as 54 stickers in a flat array (ADR-0003), which is ideal
 * for computing positions and hopeless for animating one. Turning R has to move nine
 * *pieces* together, and the nine facelets involved are scattered across five separate
 * faces of that array.
 *
 * So this file adds the missing layer: a coordinate for each sticker. Once every sticker
 * knows where it is, "the R layer" is just "every sticker with x = 1", and turning it is
 * one CSS transform on a wrapper element. The engine stays the source of truth — this
 * only describes where its numbers live.
 */

/** Cube space: x right, y up, z towards the viewer. The centre piece is the origin. */
export interface Vector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface StickerPlacement {
  /** Index into the engine's 54-entry state array. */
  readonly facelet: number;
  /** Which piece the sticker is on. */
  readonly position: Vector;
  /** The face it points out of, which is also the direction it faces. */
  readonly face: Face;
}

/** The outward direction of each face, as a unit vector. */
export const FACE_NORMALS: Record<Face, Vector> = {
  U: { x: 0, y: 1, z: 0 },
  D: { x: 0, y: -1, z: 0 },
  F: { x: 0, y: 0, z: 1 },
  B: { x: 0, y: 0, z: -1 },
  R: { x: 1, y: 0, z: 0 },
  L: { x: -1, y: 0, z: 0 },
};

/**
 * Turn a facelet index into a position.
 *
 * Each face is read left-to-right and top-to-bottom *as seen from outside the cube*, so
 * the row and column mean something different on each one. Getting a single face's
 * orientation wrong here produces a cube that looks right when solved and scrambles
 * incorrectly, which is why `geometry.test.ts` rebuilds every move from these
 * coordinates and compares it against the engine rather than trusting the derivation.
 */
function placementFor(face: Face, cell: number): Vector {
  const row = Math.floor(cell / 3);
  const column = cell % 3;

  switch (face) {
    // Looking down at the top: the first row is at the back.
    case 'U':
      return { x: column - 1, y: 1, z: row - 1 };
    // Looking up at the bottom: the first row is at the front.
    case 'D':
      return { x: column - 1, y: -1, z: 1 - row };
    case 'F':
      return { x: column - 1, y: 1 - row, z: 1 };
    // Seen from behind, the cube's right-hand side appears on the left.
    case 'B':
      return { x: 1 - column, y: 1 - row, z: -1 };
    // Seen from the right, the front of the cube appears on the left.
    case 'R':
      return { x: 1, y: 1 - row, z: 1 - column };
    case 'L':
      return { x: -1, y: 1 - row, z: column - 1 };
  }
}

/** Every sticker, in facelet order, so `STICKERS[i]` describes state index `i`. */
export const STICKERS: readonly StickerPlacement[] = FACES.flatMap((face, faceIndex) =>
  Array.from({ length: FACELETS_PER_FACE }, (_, cell) => ({
    facelet: faceIndex * FACELETS_PER_FACE + cell,
    position: placementFor(face, cell),
    face,
  })),
);

export interface Piece {
  readonly position: Vector;
  /** The stickers on this piece. Corners have three, edges two, centres one. */
  readonly stickers: readonly StickerPlacement[];
}

/**
 * The 26 visible pieces, each carrying its own stickers.
 *
 * The 27th, the core, has no stickers and is never drawn.
 */
export const PIECES: readonly Piece[] = (() => {
  const byPosition = new Map<string, StickerPlacement[]>();

  for (const sticker of STICKERS) {
    const key = positionKey(sticker.position);
    const existing = byPosition.get(key);
    if (existing === undefined) byPosition.set(key, [sticker]);
    else existing.push(sticker);
  }

  return [...byPosition.entries()].map(([, stickers]) => ({
    position: (stickers[0] as StickerPlacement).position,
    stickers,
  }));
})();

export function positionKey({ x, y, z }: Vector): string {
  return `${x},${y},${z}`;
}

/**
 * Which pieces a face's layer contains, and how that layer turns.
 *
 * `axis` and `value` select the layer; `cssAxis` and `sign` say how to spin it on
 * screen. The signs are not guessable — CSS measures y downwards, so a clockwise turn
 * seen from outside the cube is sometimes a negative rotation — and they are pinned
 * down by the tests rather than by argument.
 */
export const LAYERS: Record<
  Face,
  {
    readonly axis: keyof Vector;
    readonly value: number;
    readonly cssAxis: 'X' | 'Y' | 'Z';
    readonly sign: 1 | -1;
  }
> = {
  U: { axis: 'y', value: 1, cssAxis: 'Y', sign: -1 },
  D: { axis: 'y', value: -1, cssAxis: 'Y', sign: 1 },
  R: { axis: 'x', value: 1, cssAxis: 'X', sign: 1 },
  L: { axis: 'x', value: -1, cssAxis: 'X', sign: -1 },
  F: { axis: 'z', value: 1, cssAxis: 'Z', sign: 1 },
  B: { axis: 'z', value: -1, cssAxis: 'Z', sign: -1 },
};

/** True when this piece is carried by a turn of `face`. */
export function isInLayer(position: Vector, face: Face): boolean {
  const layer = LAYERS[face];
  return position[layer.axis] === layer.value;
}

/**
 * Rotate a point by a clockwise quarter turn of `face`, in cube space.
 *
 * Used by the tests to rebuild each move from first principles, and by nothing at
 * runtime — on screen the browser does this for us.
 */
export function rotateClockwise({ x, y, z }: Vector, face: Face): Vector {
  switch (face) {
    case 'U':
      return { x: -z, y, z: x };
    case 'D':
      return { x: z, y, z: -x };
    case 'R':
      return { x, y: z, z: -y };
    case 'L':
      return { x, y: -z, z: y };
    case 'F':
      return { x: y, y: -x, z };
    case 'B':
      return { x: -y, y: x, z };
  }
}

/** How many clockwise quarter turns a move is: 1, -1 for a prime, or 2 for a half turn. */
export function quarterTurns(move: Move): number {
  const turn = move.slice(1);
  if (turn === "'") return -1;
  if (turn === '2') return 2;
  return 1;
}

export function faceOf(move: Move): Face {
  return move[0] as Face;
}

/** The CSS transform that turns a layer part-way through a move. */
export function layerTransform(move: Move, degrees: number): string {
  const layer = LAYERS[faceOf(move)];
  return `rotate${layer.cssAxis}(${layer.sign * degrees}deg)`;
}

/** The angle, in degrees, at which a move is complete. Signed, so a prime winds back. */
export function fullAngle(move: Move): number {
  return quarterTurns(move) * 90;
}
