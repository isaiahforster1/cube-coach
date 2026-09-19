import { describe, expect, it } from 'vitest';
import {
  applyMove,
  applyMoves,
  createSolvedCube,
  FACELET_COUNT,
  FACES,
  TURNS,
  type CubeState,
  type Face,
  type Move,
} from '@cube-coach/shared';
import {
  FACE_NORMALS,
  faceOf,
  isInLayer,
  LAYERS,
  PIECES,
  positionKey,
  quarterTurns,
  rotateClockwise,
  STICKERS,
  type Vector,
} from './geometry.js';

const ALL_MOVES: Move[] = FACES.flatMap((face) => TURNS.map((turn) => `${face}${turn}` as Move));

/** Which facelet sits at a given position facing a given direction. */
const FACELET_AT = new Map(
  STICKERS.map((sticker) => [`${positionKey(sticker.position)}|${sticker.face}`, sticker.facelet]),
);

function faceForNormal(normal: Vector): Face {
  const face = FACES.find((candidate) => {
    const n = FACE_NORMALS[candidate];
    return n.x === normal.x && n.y === normal.y && n.z === normal.z;
  });
  if (face === undefined) throw new Error(`No face points along ${positionKey(normal)}`);
  return face;
}

function rotateTimes(vector: Vector, face: Face, times: number): Vector {
  let result = vector;
  // A prime turn is three clockwise turns, which keeps this to one rotation function.
  const count = ((times % 4) + 4) % 4;
  for (let i = 0; i < count; i += 1) result = rotateClockwise(result, face);
  return result;
}

/**
 * Apply a move using only the coordinates, with no reference to the engine's tables.
 *
 * Each sticker in the turned layer is carried to wherever its piece and its facing
 * direction end up; everything else stays put.
 */
function applyMoveGeometrically(state: CubeState, move: Move): CubeState {
  const face = faceOf(move);
  const turns = quarterTurns(move);
  const result: Face[] = Array.from({ length: FACELET_COUNT }) as Face[];

  for (const sticker of STICKERS) {
    let destination = sticker.facelet;

    if (isInLayer(sticker.position, face)) {
      const position = rotateTimes(sticker.position, face, turns);
      const facing = faceForNormal(rotateTimes(FACE_NORMALS[sticker.face], face, turns));
      const found = FACELET_AT.get(`${positionKey(position)}|${facing}`);
      if (found === undefined)
        throw new Error(`Nothing at ${positionKey(position)} facing ${facing}`);
      destination = found;
    }

    result[destination] = state[sticker.facelet] as Face;
  }

  return result;
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('sticker coordinates', () => {
  it('places all 54 stickers', () => {
    expect(STICKERS).toHaveLength(FACELET_COUNT);
  });

  it('gives every sticker a distinct position and facing', () => {
    expect(FACELET_AT.size).toBe(FACELET_COUNT);
  });

  it('leaves the invisible core out and draws the other 26 pieces', () => {
    expect(PIECES).toHaveLength(26);
  });

  it('gives corners three stickers, edges two and centres one', () => {
    for (const piece of PIECES) {
      const { x, y, z } = piece.position;
      const onSurface = [x, y, z].filter((component) => component !== 0).length;
      expect(piece.stickers).toHaveLength(onSurface);
    }
  });

  it('puts nine pieces in every layer', () => {
    for (const face of FACES) {
      expect(PIECES.filter((piece) => isInLayer(piece.position, face))).toHaveLength(9);
    }
  });
});

/**
 * The test that matters.
 *
 * The engine's move tables were derived one way (adjacent strips of facelet indices);
 * these coordinates were derived another (positions in space). If both are right they
 * must produce identical moves, and if either is wrong they will disagree almost
 * immediately. An earlier version of the engine's tables had three faces reversed, and a
 * cross-check exactly like this is what found it.
 */
describe('coordinates agree with the engine', () => {
  it.each(ALL_MOVES)('reproduces %s from coordinates alone', (move) => {
    const random = makeRandom(1234 + move.length);

    // Random positions, not a solved cube: on a solved cube every sticker on a face is
    // the same colour, so a mapping that scrambles cells within one face would pass.
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const setup = Array.from(
        { length: 20 },
        () => ALL_MOVES[Math.floor(random() * ALL_MOVES.length)] as Move,
      );
      const state = applyMoves(createSolvedCube(), setup);

      expect(applyMoveGeometrically(state, move)).toEqual(applyMove(state, move));
    }
  });
});

/**
 * CSS rotates about screen axes, and the screen's y points *down* while the cube's
 * points up. That flip means a clockwise turn is a negative CSS rotation for some faces
 * and a positive one for others, which is exactly the sort of thing that is easier to
 * get wrong than to notice: half the moves animate the correct way and the rest spin
 * backwards, ending in the right position anyway.
 */
describe('on-screen rotation directions', () => {
  const toScreen = ({ x, y, z }: Vector): Vector => ({ x, y: -y, z });

  /** A quarter turn about a screen axis, matching how CSS defines rotateX/Y/Z. */
  function cssQuarterTurn({ x, y, z }: Vector, axis: 'X' | 'Y' | 'Z', sign: number): Vector {
    const s = sign;
    if (axis === 'X') return { x, y: -s * z, z: s * y };
    if (axis === 'Y') return { x: s * z, y, z: -s * x };
    return { x: -s * y, y: s * x, z };
  }

  it.each(FACES)('turns the %s layer the way the cube does', (face) => {
    const { cssAxis, sign } = LAYERS[face];

    for (const point of STICKERS.map((sticker) => sticker.position)) {
      expect(cssQuarterTurn(toScreen(point), cssAxis, sign)).toEqual(
        toScreen(rotateClockwise(point, face)),
      );
    }
  });
});
