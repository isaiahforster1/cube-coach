import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyMove, applyMoves, createSolvedCube } from '../cube/cube.js';
import { readCorners } from '../analysis/corners.js';
import { readEdges } from '../analysis/edges.js';
import { ALL_MOVES, CORNER_DIGIT, EDGE_DIGIT } from './pieces.js';

describe('piece digit tables', () => {
  /**
   * The search never looks at stickers, so these tables are the only thing tying it to the
   * real cube. Checked for every move, from random positions, against the sticker model.
   */
  it('move every piece where the sticker model does', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...ALL_MOVES), { maxLength: 25 }), (scramble) => {
        const state = applyMoves(createSolvedCube(), scramble);
        const edges = readEdges(state);
        const corners = readCorners(state);

        for (const [m, move] of ALL_MOVES.entries()) {
          const after = applyMove(state, move);
          const afterEdges = readEdges(after);
          const afterCorners = readCorners(after);
          for (const [slot, { piece, orientation }] of edges.entries()) {
            const d = EDGE_DIGIT[m * 24 + slot * 2 + orientation] ?? -1;
            expect(afterEdges[d >> 1]).toEqual({ piece, orientation: d & 1 });
          }
          for (const [slot, { piece, orientation }] of corners.entries()) {
            const d = CORNER_DIGIT[m * 24 + slot * 3 + orientation] ?? -1;
            expect(afterCorners[Math.floor(d / 3)]).toEqual({ piece, orientation: d % 3 });
          }
        }
      }),
      { numRuns: 30, seed: 2103 },
    );
  });
});
