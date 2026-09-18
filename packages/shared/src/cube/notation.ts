import { FACES, TURNS, type Face, type Move, type Turn } from './types.js';

/** Thrown when a string is not valid move notation. Carries the offending token. */
export class InvalidNotationError extends Error {
  constructor(
    readonly token: string,
    readonly position: number,
  ) {
    super(`Invalid move '${token}' at position ${position}`);
    this.name = 'InvalidNotationError';
  }
}

const MOVES: ReadonlySet<string> = new Set(
  FACES.flatMap((face) => TURNS.map((turn) => `${face}${turn}`)),
);

export function isMove(value: string): value is Move {
  return MOVES.has(value);
}

/**
 * Parse an algorithm such as `"R U R' U2"` into a list of moves.
 *
 * Apostrophes are normalised first, because text copied from tutorials and forums
 * routinely contains a typographic quote (U’) rather than an ASCII one (U'), and
 * rejecting it would look like a bug to the user.
 *
 * Case is *not* normalised. In standard cube notation a lowercase letter means a wide
 * turn — two layers at once — which this engine does not implement. Silently treating
 * `r` as `R` would quietly produce the wrong cube.
 */
export function parseAlgorithm(input: string): Move[] {
  const tokens = input.replaceAll('’', "'").trim().split(/\s+/u).filter(Boolean);

  return tokens.map((token, index) => {
    if (!isMove(token)) {
      throw new InvalidNotationError(token, index);
    }
    return token;
  });
}

/** Render a list of moves back to notation, space separated. */
export function formatAlgorithm(moves: readonly Move[]): string {
  return moves.join(' ');
}

/** The move that undoes the given one. A half turn is its own inverse. */
export function invertMove(move: Move): Move {
  const face = move[0] as Face;
  const turn = move.slice(1) as Turn;

  if (turn === '2') return move;
  return turn === "'" ? face : `${face}'`;
}

/**
 * The sequence that undoes the given one.
 *
 * Both the order and each individual move have to be reversed: undoing "socks, then
 * shoes" means taking off the shoes first. This is the same reason `(AB)⁻¹ = B⁻¹A⁻¹`
 * for matrices, and forgetting the reversal is the classic bug here.
 */
export function invertAlgorithm(moves: readonly Move[]): Move[] {
  return [...moves].reverse().map(invertMove);
}
