import { AXES, FACES, TURNS, type Move, type Rotation, type Token } from './types.js';

/**
 * Thrown when a string is not valid move notation. Carries the offending token.
 *
 * `index` is zero-based, for code. The message counts from one, because it is shown to
 * people, and "move 1" should mean the first move.
 */
export class InvalidNotationError extends Error {
  constructor(
    readonly token: string,
    readonly index: number,
  ) {
    super(`Invalid move '${token}' at move ${index + 1}`);
    this.name = 'InvalidNotationError';
  }
}

const MOVES: ReadonlySet<string> = new Set(
  FACES.flatMap((face) => TURNS.map((turn) => `${face}${turn}`)),
);

const ROTATIONS: ReadonlySet<string> = new Set(
  AXES.flatMap((axis) => TURNS.map((turn) => `${axis}${turn}`)),
);

export function isMove(value: string): value is Move {
  return MOVES.has(value);
}

export function isRotation(value: string): value is Rotation {
  return ROTATIONS.has(value);
}

export function isToken(value: string): value is Token {
  return isMove(value) || isRotation(value);
}

/**
 * Split notation into tokens and check each one with `accepts`.
 *
 * Apostrophes are normalised first, because text copied from tutorials and forums
 * routinely contains a typographic quote (U’) rather than an ASCII one (U'), and
 * rejecting it would look like a bug to the user.
 */
function parseWith<T extends string>(input: string, accepts: (token: string) => token is T): T[] {
  const tokens = input.replaceAll('’', "'").trim().split(/\s+/u).filter(Boolean);

  return tokens.map((token, index) => {
    if (!accepts(token)) {
      throw new InvalidNotationError(token, index);
    }
    return token;
  });
}

/**
 * Parse an algorithm such as `"R U R' U2"` into a list of face turns.
 *
 * Rotations are rejected here: this is what scrambles and stored algorithms go through,
 * and none of them may contain one. Use {@link parseSequence} where rotations belong.
 *
 * Case is *not* normalised. In standard cube notation a lowercase letter means a wide
 * turn — two layers at once — which this engine does not implement. Silently treating
 * `r` as `R` would quietly produce the wrong cube.
 */
export function parseAlgorithm(input: string): Move[] {
  return parseWith(input, isMove);
}

/**
 * Parse a sequence that may contain whole-cube rotations, such as `"y R U R'"`.
 *
 * `x`, `y` and `z` are lowercase by convention and are the one exception to the rule
 * above; wide turns such as `r` and `u` are still rejected.
 */
export function parseSequence(input: string): Token[] {
  return parseWith(input, isToken);
}

/** Render a list of moves back to notation, space separated. */
export function formatAlgorithm(moves: readonly Token[]): string {
  return moves.join(' ');
}

/**
 * The token that undoes the given one. A half turn is its own inverse.
 *
 * Face turns and rotations share the same suffixes, so one rule covers both. The
 * overloads keep a `Move` a `Move`, so inverting a scramble cannot widen its type.
 */
export function invertToken(token: Move): Move;
export function invertToken(token: Rotation): Rotation;
export function invertToken(token: Token): Token;
export function invertToken(token: Token): Token {
  const base = token.slice(0, 1);
  const turn = token.slice(1);

  if (turn === '2') return token;
  return (turn === "'" ? base : `${base}'`) as Token;
}

/** The move that undoes the given one. A half turn is its own inverse. */
export function invertMove(move: Move): Move {
  return invertToken(move);
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

/** {@link invertAlgorithm} for sequences that may contain rotations. */
export function invertSequence(tokens: readonly Token[]): Token[] {
  return [...tokens].reverse().map((token) => invertToken(token));
}
