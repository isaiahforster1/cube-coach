import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyMoves, applySequence, createSolvedCube } from '../cube/cube.js';
import { invertSequence } from '../cube/notation.js';
import { AXES, FACES, TURNS, type Face, type Move, type Rotation } from '../cube/types.js';
import { frameOf, present, SCRAMBLE_FRAME, setupRotationFor, toHeld } from './frame.js';
import { HELD_POSITIONS, NOTATION_LETTER } from './held.js';

const ALL_MOVES = FACES.flatMap((face) => TURNS.map((turn) => `${face}${turn}` as Move));
const ALL_ROTATIONS = AXES.flatMap((axis) => TURNS.map((turn) => `${axis}${turn}` as Rotation));

describe('frameOf', () => {
  it('leaves every face where it is when nothing is rotated', () => {
    for (const held of HELD_POSITIONS) {
      const face = NOTATION_LETTER[held];
      expect(SCRAMBLE_FRAME.fixedFaceAt[held]).toBe(face);
      expect(toHeld(`${face}2`, SCRAMBLE_FRAME)).toBe(`${face}2`);
    }
  });

  it('reads y as carrying the front centre to the left', () => {
    // y turns the cube like U: what was on the right is now in front.
    const frame = frameOf(['y']);

    expect(frame.fixedFaceAt.front).toBe('R');
    expect(toHeld('R', frame)).toBe('F');
  });

  it('keeps its two maps inverse to each other', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...ALL_ROTATIONS), { maxLength: 4 }), (rotations) => {
        const frame = frameOf(rotations);
        return HELD_POSITIONS.every(
          (held) => frame.heldPositionOf[frame.fixedFaceAt[held]] === held,
        );
      }),
    );
  });
});

describe('translation identity (ADR-0021 §5)', () => {
  /**
   * The one claim the whole design rests on. Performing the presented tokens on a real
   * cube, then undoing the rotations, must land exactly where the fixed-frame moves do.
   * Compared on all 54 stickers, using only the verified permutation tables.
   */
  it('presented tokens, then the frame undone, equal the fixed-frame moves', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ALL_MOVES), { maxLength: 20 }),
        fc.array(fc.constantFrom(...ALL_ROTATIONS), { maxLength: 4 }),
        fc.array(fc.constantFrom(...ALL_MOVES), { maxLength: 12 }),
        (scramble, rotations, moves) => {
          const start = applyMoves(createSolvedCube(), scramble);
          const tokens = present(moves, rotations, frameOf(rotations));
          const held = applySequence(start, [...tokens, ...invertSequence(rotations)]);

          expect(held).toEqual(applyMoves(start, moves));
        },
      ),
      { numRuns: 300, seed: 20210 },
    );
  });
});

describe('setupRotationFor', () => {
  const expected: Record<Face, string> = { D: '', U: 'z2', F: "x'", B: 'x', R: 'z', L: "z'" };

  it.each(FACES)('brings %s to the bottom with the expected rotation', (face) => {
    const setup = setupRotationFor(face);

    expect(setup.join(' ')).toBe(expected[face]);
    // Judged on the stickers: the bottom centre of a rotated solved cube.
    expect(applySequence(createSolvedCube(), setup)[31]).toBe(face);
  });

  /** ADR-0021, decision 1: x2 would also swap front and back. */
  it('chooses z2 for a U cross because it keeps the front centre in front', () => {
    expect(frameOf(setupRotationFor('U')).fixedFaceAt.front).toBe('F');
    expect(frameOf(['x2']).fixedFaceAt.front).toBe('B');
  });

  /** The search stops at two rotations; this proves that is enough for every orientation. */
  it('can reach all 24 orientations within two rotations', () => {
    const seen = new Set<string>();
    for (const first of [undefined, ...ALL_ROTATIONS]) {
      for (const second of [undefined, ...ALL_ROTATIONS]) {
        const rotations = [first, second].filter((r): r is Rotation => r !== undefined);
        seen.add(HELD_POSITIONS.map((held) => frameOf(rotations).fixedFaceAt[held]).join(''));
      }
    }

    expect(seen.size).toBe(24);
  });
});
