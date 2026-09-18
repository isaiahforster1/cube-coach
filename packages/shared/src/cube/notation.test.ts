import { describe, expect, it } from 'vitest';
import {
  formatAlgorithm,
  InvalidNotationError,
  invertAlgorithm,
  invertMove,
  isMove,
  parseAlgorithm,
} from './notation.js';

describe('parseAlgorithm', () => {
  it('parses a simple algorithm', () => {
    expect(parseAlgorithm("R U R' U2")).toEqual(['R', 'U', "R'", 'U2']);
  });

  it('tolerates irregular whitespace', () => {
    expect(parseAlgorithm('  R\t\tU \n F  ')).toEqual(['R', 'U', 'F']);
  });

  it('accepts a typographic apostrophe, as pasted from the web', () => {
    expect(parseAlgorithm('R’ U’')).toEqual(["R'", "U'"]);
  });

  it('parses an empty string as an empty algorithm', () => {
    expect(parseAlgorithm('   ')).toEqual([]);
  });

  it('rejects an unknown face', () => {
    expect(() => parseAlgorithm('R X U')).toThrow(InvalidNotationError);
  });

  it('rejects lowercase, which means a wide turn we do not support', () => {
    expect(() => parseAlgorithm('r U')).toThrow(InvalidNotationError);
  });

  it('rejects an unsupported modifier', () => {
    expect(() => parseAlgorithm('R3')).toThrow(InvalidNotationError);
  });

  it('reports which token failed and where', () => {
    expect(() => parseAlgorithm('R U Q2 F')).toThrow(/Invalid move 'Q2' at position 2/u);
  });
});

describe('formatAlgorithm', () => {
  it('round-trips through parse', () => {
    const algorithm = "R U R' U' R' F R2 U' R' U' R U R' F'";
    expect(formatAlgorithm(parseAlgorithm(algorithm))).toBe(algorithm);
  });
});

describe('invertMove', () => {
  it('turns a clockwise quarter into an anticlockwise one', () => {
    expect(invertMove('R')).toBe("R'");
  });

  it('turns an anticlockwise quarter into a clockwise one', () => {
    expect(invertMove("R'")).toBe('R');
  });

  it('leaves a half turn unchanged', () => {
    expect(invertMove('R2')).toBe('R2');
  });
});

describe('invertAlgorithm', () => {
  it('reverses the order as well as each move', () => {
    expect(invertAlgorithm(parseAlgorithm("R U2 F'"))).toEqual(['F', 'U2', "R'"]);
  });

  it('is its own inverse', () => {
    const moves = parseAlgorithm("R U R' U' F2 D");
    expect(invertAlgorithm(invertAlgorithm(moves))).toEqual(moves);
  });
});

describe('isMove', () => {
  it('accepts every legal move', () => {
    expect(isMove('U')).toBe(true);
    expect(isMove("B'")).toBe(true);
    expect(isMove('D2')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isMove('')).toBe(false);
    expect(isMove('M')).toBe(false);
    expect(isMove('RR')).toBe(false);
  });
});
