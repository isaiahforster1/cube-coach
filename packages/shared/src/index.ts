/**
 * Shared domain code used by both the web client and the API.
 *
 * This package deliberately depends on no framework: no React, no Fastify, no
 * database client. It is plain TypeScript over plain data, which is what makes it
 * fast to test and safe to run in either process.
 */
export * from './cube/index.js';
export * from './scramble/index.js';
export * from './contracts/index.js';
export * from './timer/index.js';
export * from './stats/index.js';
export * from './analysis/index.js';
export * from './algorithms/index.js';

/**
 * The solver is exported by name, not with `*`. Its sticker oracle has an
 * `isFirstTwoLayersSolved` that judges against the centres, and `algorithms/` has one that
 * judges a fixed-frame cube. Same name, different question: the oracle stays inside
 * `solver/`, where its tests import it directly.
 */
export {
  checkNotation,
  chooseExplanation,
  factOf,
  notationIn,
  solveCross,
  solveF2L,
  templateExplanation,
  type ColourNames,
  type CrossStep,
  type ExplainableStep,
  type Explanation,
  type F2LResult,
  type PairStep,
  type PieceSticker,
  type SlotRef,
  type StepFact,
} from './solver/index.js';
