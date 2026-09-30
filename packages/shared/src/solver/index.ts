/**
 * The step solver (ADR-0021). Deterministic, no I/O. The cross, F2L and the facts each
 * step's explanation is built from; the package root exports this once there is a caller.
 */
export { solveCross, type CrossStep } from './cross.js';
export {
  factOf,
  type AlsoSolvedFact,
  type CornerLocation,
  type CornerTwist,
  type CrossSummaryFact,
  type EdgeLocation,
  type OtherSlot,
  type PairChoiceFact,
  type PairJoinedFact,
  type PairLocatedFact,
  type PieceSticker,
  type PreservedFact,
  type SlotRef,
  type StepFact,
} from './facts.js';
export {
  F2L_LIMITS,
  prepareF2L,
  slotsFor,
  solveF2L,
  type F2LResult,
  type PairStep,
  type SearchLimits,
  type Slot,
  type SlotSearch,
} from './f2l.js';
export { frameOf, present, SCRAMBLE_FRAME, setupRotationFor, toHeld, type Frame } from './frame.js';
export {
  HELD_POSITIONS,
  HELD_SLOTS,
  heldSlotBetween,
  type HeldPosition,
  type HeldSlot,
} from './held.js';
export { isCrossSolved, isFirstTwoLayersSolved, isPairSolved } from './oracle.js';
