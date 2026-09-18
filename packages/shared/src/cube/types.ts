/**
 * Core types for the 3x3x3 cube.
 *
 * The cube is modelled as 54 stickers rather than as 20 movable pieces. A move is
 * therefore a fixed reshuffle of sticker positions, which is simple to test and maps
 * directly onto rendering. See ADR-0003 for why.
 */

/**
 * The six faces, in the order their stickers appear in {@link CubeState}.
 *
 * U(p), R(ight), F(ront), D(own), L(eft), B(ack) is the standard ordering used by
 * cube literature and by cubing.js, so our indices line up with external tools.
 */
export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'] as const;

export type Face = (typeof FACES)[number];

export const FACELETS_PER_FACE = 9;
export const FACELET_COUNT = FACES.length * FACELETS_PER_FACE;

/**
 * How far a face is turned. `''` is a quarter turn clockwise, `'` is a quarter turn
 * anticlockwise, and `2` is a half turn (direction is irrelevant for a half turn).
 */
export const TURNS = ['', "'", '2'] as const;

export type Turn = (typeof TURNS)[number];

/**
 * Every legal move, as a union of 18 string literals: `'U' | "U'" | 'U2' | 'R' | ...`
 *
 * TypeScript builds this by combining the two unions above, so the list cannot drift
 * out of sync with FACES and TURNS, and an invalid string like `'X2'` fails to compile.
 */
export type Move = `${Face}${Turn}`;

/**
 * A cube position: 54 stickers, each labelled with the face it belongs to when solved.
 *
 * Index layout — each face is read left-to-right, top-to-bottom, as seen from outside:
 *
 * ```
 *            U:  0  1  2
 *                3  4  5
 *                6  7  8
 *
 * L: 36 37 38   F: 18 19 20   R:  9 10 11   B: 45 46 47
 *    39 40 41      21 22 23      12 13 14      48 49 50
 *    42 43 44      24 25 26      15 16 17      51 52 53
 *
 *            D: 27 28 29
 *               30 31 32
 *               33 34 35
 * ```
 *
 * Stickers are labelled by face, not by colour. Colour is a display concern and lives
 * in the UI, so the engine stays independent of any particular colour scheme.
 *
 * The array is readonly because every operation returns a new state rather than
 * mutating the old one. That makes solve replay, undo, and React rendering all
 * straightforward, and it is cheap at this size.
 */
export type CubeState = readonly Face[];
