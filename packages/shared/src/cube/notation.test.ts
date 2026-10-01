import { describe, expect, it } from 'vitest';
import {
  formatAlgorithm,
  InvalidNotationError,
  invertAlgorithm,
  invertMove,
  invertSequence,
  invertToken,
  isMove,
  isRotation,
  isToken,
  parseAlgorithm,
  parseSequence,
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

  it('reports which token failed, counting moves from one for people and zero for code', () => {
    expect(() => parseAlgorithm('R U Q2 F')).toThrow(/Invalid move 'Q2' at move 3$/u);
    expect(() => parseAlgorithm('R U Q2 F')).toThrow(expect.objectContaining({ index: 2 }));
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

describe('parseSequence', () => {
  it('accepts rotations alongside face turns', () => {
    expect(parseSequence("y R U R' x2 z'")).toEqual(['y', 'R', 'U', "R'", 'x2', "z'"]);
  });

  it('accepts a typographic apostrophe on a rotation', () => {
    expect(parseSequence('y’')).toEqual(["y'"]);
  });

  it('still rejects wide turns, which are also lowercase', () => {
    expect(() => parseSequence('r U')).toThrow(InvalidNotationError);
  });

  it('rejects an uppercase rotation', () => {
    expect(() => parseSequence('X')).toThrow(InvalidNotationError);
  });
});

describe('parseAlgorithm and rotations', () => {
  it('rejects a rotation, because scrambles and stored algorithms may not contain one', () => {
    expect(() => parseAlgorithm("y R U R'")).toThrow(/Invalid move 'y' at move 1$/u);
  });
});

describe('invertToken', () => {
  it('inverts a rotation the same way as a face turn', () => {
    expect(invertToken('x')).toBe("x'");
    expect(invertToken("y'")).toBe('y');
    expect(invertToken('z2')).toBe('z2');
  });
});

describe('invertSequence', () => {
  it('reverses the order as well as each token', () => {
    expect(invertSequence(parseSequence("y R U' x2"))).toEqual(['x2', 'U', "R'", "y'"]);
  });
});

describe('isRotation and isToken', () => {
  it('tells rotations from face turns', () => {
    expect(isRotation('x')).toBe(true);
    expect(isRotation('R')).toBe(false);
    expect(isToken('x')).toBe(true);
    expect(isToken('R')).toBe(true);
    expect(isToken('M')).toBe(false);
  });
});
