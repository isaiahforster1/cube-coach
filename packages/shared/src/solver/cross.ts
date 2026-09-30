/**
 * The cross step of the solver (ADR-0021 §2 and §3).
 *
 * The cross is found by walking down the distance table `analysis/cross.ts` already
 * builds: from the current position, take a move that lowers the distance by one, until
 * it is zero. That makes it optimal by construction, with no new search.
 */
import { applyMove } from '../cube/cube.js';
import {
  TURNS,
  type CubeState,
  type Face,
  type Move,
  type Rotation,
  type Token,
} from '../cube/types.js';
import { crossDistance } from '../analysis/cross.js';
import { crossFacts, type StepFact } from './facts.js';
import { frameOf, heldFaceOf, present, setupRotationFor, type Frame } from './frame.js';
import type { HeldPosition } from './held.js';

export interface CrossStep {
  /** The cross colour, as the fixed face it belongs to. */
  readonly face: Face;
  /** The rotation that brings the cross face to the bottom. Empty for a `D` cross. */
  readonly setup: readonly Rotation[];
  /** How the cube is held for this step and, until F2L changes it, afterwards. */
  readonly frame: Frame;
  /** The solution in the fixed frame. What the solver reasons about. */
  readonly moves: readonly Move[];
  /** The setup rotation, then the moves as held. What the person is shown. */
  readonly tokens: readonly Token[];
  /** What an explanation of this step may say (ADR-0021 §6): a `cross-summary`. */
  readonly facts: readonly StepFact[];
}

/**
 * Held faces in order of preference, used only to break ties between optimal moves.
 *
 * ADR-0021 puts `R U F L` in the cheap group and `D B` in the dearer one. The order
 * within each group is not a claim about speed; it is an arbitrary, fixed choice so that
 * the same scramble always gets the same cross.
 */
const HELD_PREFERENCE: readonly HeldPosition[] = [
  'right',
  'top',
  'front',
  'left',
  'bottom',
  'back',
];

/**
 * Every move, cheapest first when performed as held, then quarter before inverse before half.
 * F2L uses the same order, minus held `D` and `B`, so both steps break ties the same way.
 */
export function movesByHeldCost(frame: Frame): Move[] {
  return HELD_PREFERENCE.flatMap((held) =>
    TURNS.map((turn) => `${frame.fixedFaceAt[held]}${turn}` as Move),
  );
}

/**
 * An optimal cross on `face`, held with that face on the bottom.
 *
 * `state` is the scrambled cube as scrambled: reached by face turns only, centres at
 * home. Among the moves that make progress, the one that is cheapest as held is taken at
 * each point. That is a per-move tie-break, not the cheapest of all optimal crosses.
 */
export function solveCross(state: CubeState, face: Face = 'D'): CrossStep {
  const setup = setupRotationFor(face);
  const frame = frameOf(setup);
  const candidates = movesByHeldCost(frame);

  const moves: Move[] = [];
  let current = state;
  let distance = crossDistance(current, face);

  while (distance > 0) {
    const next = candidates.find(
      (move) => crossDistance(applyMove(current, move), face) === distance - 1,
    );
    if (next === undefined) {
      throw new Error('No move lowers the cross distance, which is impossible');
    }
    moves.push(next);
    current = applyMove(current, next);
    distance -= 1;
  }

  return {
    face,
    setup,
    frame,
    moves,
    tokens: present(moves, setup, frame),
    facts: crossFacts(state, face, frame, moves),
  };
}

/** How dear a fixed-frame move is as held: its face's place in {@link HELD_PREFERENCE}. */
export function heldCost(move: Move, frame: Frame): number {
  return HELD_PREFERENCE.indexOf(heldFaceOf(move, frame));
}
