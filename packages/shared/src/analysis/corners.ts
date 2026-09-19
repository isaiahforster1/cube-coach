import { at } from '../cube/permutations.js';
import { type CubeState, type Face } from '../cube/types.js';

/**
 * The eight corner slots, each named by its three faces **in clockwise order seen from
 * outside the corner**, with the facelet index of each.
 *
 * The clockwise ordering is what makes orientation meaningful: a corner can sit in the
 * right place twisted one of three ways, and "twisted by one" only means anything if
 * every slot agrees which way round it reads.
 *
 * These 24 numbers are hand-entered, like {@link EDGE_SLOTS}. Two tests check them: one
 * that a solved cube reads each slot as exactly the faces its name claims, and one that
 * every move leaves the total twist divisible by three — an invariant of the physical
 * cube that fails immediately if any slot is listed the wrong way round.
 */
export const CORNER_SLOTS: readonly {
  readonly name: string;
  readonly facelets: readonly [number, number, number];
}[] = [
  { name: 'URF', facelets: [8, 9, 20] },
  { name: 'UFL', facelets: [6, 18, 38] },
  { name: 'ULB', facelets: [0, 36, 47] },
  { name: 'UBR', facelets: [2, 45, 11] },
  { name: 'DFR', facelets: [29, 26, 15] },
  { name: 'DRB', facelets: [35, 17, 51] },
  { name: 'DBL', facelets: [33, 53, 42] },
  { name: 'DLF', facelets: [27, 44, 24] },
];

export const CORNER_COUNT = CORNER_SLOTS.length;

/** Which corner piece is sitting in a slot, and how it is twisted. */
export interface CornerPlacement {
  /** The home slot of the piece currently here, 0-7. */
  readonly piece: number;
  /**
   * How many clockwise steps the piece has been turned within its slot: 0 when its
   * first sticker is on the slot's first facelet, 1 or 2 otherwise.
   */
  readonly orientation: number;
}

/** Look up a corner by its faces in any order, since a piece can arrive any way round. */
const SLOT_BY_FACES = new Map<string, number>();
for (const [index, slot] of CORNER_SLOTS.entries()) {
  SLOT_BY_FACES.set([...slot.name].sort().join(''), index);
}

/**
 * Read the corners of a cube position.
 *
 * The counterpart to {@link readEdges}: the engine stores stickers, and piece-level
 * analysis needs pieces. Derived from the facelets rather than maintained separately, so
 * there is still only one source of truth about the cube.
 */
export function readCorners(state: CubeState): CornerPlacement[] {
  return CORNER_SLOTS.map((slot) => {
    const faces = slot.facelets.map((facelet) => at(state, facelet)) as [Face, Face, Face];

    const piece = SLOT_BY_FACES.get([...faces].sort().join(''));
    if (piece === undefined) {
      throw new Error(`No corner piece has the faces ${faces.join('')}`);
    }

    // The piece's own first face, and where it has landed in this slot's reading order,
    // gives the twist directly.
    const home = at(CORNER_SLOTS, piece);
    const homeFirst = [...home.name][0];
    const orientation = faces.indexOf(homeFirst as Face);

    if (orientation === -1) {
      throw new Error(`Corner ${home.name} is in slot ${slot.name} without its own sticker`);
    }

    return { piece, orientation };
  });
}
