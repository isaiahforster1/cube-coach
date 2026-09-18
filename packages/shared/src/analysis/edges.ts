import { applyMove, createSolvedCube } from '../cube/cube.js';
import { at } from '../cube/permutations.js';
import { FACES, TURNS, type CubeState, type Face, type Move } from '../cube/types.js';

/**
 * The twelve edge slots, each named by the two faces it touches, with the two facelet
 * indices that make it up. The first facelet defines the edge's orientation reference.
 *
 * These 24 numbers are the only hand-entered data here. A test asserts that on a solved
 * cube every slot reads exactly the two faces its name claims, which catches a wrong
 * index immediately.
 */
export const EDGE_SLOTS: readonly {
  readonly name: string;
  readonly facelets: readonly [number, number];
}[] = [
  { name: 'UF', facelets: [7, 19] },
  { name: 'UR', facelets: [5, 10] },
  { name: 'UB', facelets: [1, 46] },
  { name: 'UL', facelets: [3, 37] },
  { name: 'DF', facelets: [28, 25] },
  { name: 'DR', facelets: [32, 16] },
  { name: 'DB', facelets: [34, 52] },
  { name: 'DL', facelets: [30, 43] },
  { name: 'FR', facelets: [23, 12] },
  { name: 'FL', facelets: [21, 41] },
  { name: 'BR', facelets: [48, 14] },
  { name: 'BL', facelets: [50, 39] },
];

export const EDGE_COUNT = EDGE_SLOTS.length;

/** Which edge piece is sitting in a slot, and which way round it is. */
export interface EdgePlacement {
  /** The home slot of the piece currently here, 0-11. */
  readonly piece: number;
  /** 0 when the piece's first facelet is on the slot's first facelet, 1 when flipped. */
  readonly orientation: number;
}

const SLOT_BY_FACE_PAIR = new Map<string, number>();
for (const [index, slot] of EDGE_SLOTS.entries()) {
  const [first, second] = [...slot.name] as [Face, Face];
  SLOT_BY_FACE_PAIR.set(`${first}${second}`, index);
  SLOT_BY_FACE_PAIR.set(`${second}${first}`, index);
}

/**
 * Read the edges of a cube position.
 *
 * This is the converter ADR-0003 deferred: the engine stores stickers, and piece-level
 * analysis needs pieces. Deriving it from the facelets rather than maintaining a second
 * representation means there is still only one source of truth about the cube.
 */
export function readEdges(state: CubeState): EdgePlacement[] {
  return EDGE_SLOTS.map((slot) => {
    const first = at(state, slot.facelets[0]);
    const second = at(state, slot.facelets[1]);

    const piece = SLOT_BY_FACE_PAIR.get(`${first}${second}`);
    if (piece === undefined) {
      throw new Error(`No edge piece has the faces ${first}${second}`);
    }

    // Orientation is measured against the piece's own home slot: flipped when the
    // facelet that belongs first is sitting second.
    const home = at(EDGE_SLOTS, piece);
    const homeFirst = [...home.name][0];

    return { piece, orientation: first === homeFirst ? 0 : 1 };
  });
}

export interface EdgeMoveEffect {
  /** Where the piece from slot `i` ends up. */
  readonly destination: readonly number[];
  /** Whether the piece from slot `i` is flipped by the move. */
  readonly flip: readonly number[];
}

/**
 * How each move rearranges the edges, derived by applying the move to a solved cube and
 * seeing where everything went.
 *
 * Nothing here is hand-written. The facelet permutations are already verified two
 * independent ways (known cube identities and a geometric derivation), so anything
 * derived from them inherits that confidence rather than adding a new thing to get wrong.
 */
export const EDGE_MOVES: Record<Move, EdgeMoveEffect> = (() => {
  const table: Partial<Record<Move, EdgeMoveEffect>> = {};

  for (const face of FACES) {
    for (const turn of TURNS) {
      const move = `${face}${turn}` as Move;
      const placements = readEdges(applyMove(createSolvedCube(), move));

      const destination = new Array<number>(EDGE_COUNT).fill(0);
      const flip = new Array<number>(EDGE_COUNT).fill(0);

      for (const [slot, placement] of placements.entries()) {
        // Slot `slot` now holds the piece whose home is `placement.piece`, so that piece
        // travelled from its home to here.
        destination[placement.piece] = slot;
        flip[placement.piece] = placement.orientation;
      }

      table[move] = { destination, flip };
    }
  }

  return table as Record<Move, EdgeMoveEffect>;
})();
