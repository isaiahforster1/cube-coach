# ADR-0003: Represent the cube as stickers, not pieces

## Status

Accepted — 2026-09-18

## Context

Every cube feature depends on how a cube position is stored. The MVP needs to apply
scramble moves, draw the cube on screen, and store positions alongside solves. Later,
solve analysis will need to reason about individual pieces.

There are two established representations.

**Stickers (facelets).** 54 stickers, each labelled with the face it belongs to. A move
is a fixed reshuffle of positions: "whatever is at index 20 moves to index 2".

**Pieces (cubies).** 8 corners and 12 edges, each with a position and an orientation. This
is what solvers use, because it makes the mathematics of solvability tractable — corner
orientations must sum to a multiple of three, permutation parity must match, and so on.

## Decision

Stickers, as `readonly Face[]` of length 54, with each move stored as a lookup table of
54 indices.

All operations return a new state rather than mutating the one they are given.

## Consequences

**Made easier.** Moves are trivially testable: a permutation must be a bijection, four
quarter turns must return to the start. Rendering in M10 needs stickers, and this gives
them directly with no conversion. The whole model is explainable in one sentence, which
matters for a project being used to learn.

Immutability makes solve replay, undo, and React rendering straightforward — a previous
state is always still valid. At 54 entries per move the copying cost is irrelevant.

**Made harder.** Validating that a position is physically reachable needs piece-level
analysis, so `fromFaceletString` checks structure (length, characters, nine of each face)
but not solvability. That is acceptable because scrambles come from a trusted generator
rather than from user input. If users ever type in a position by hand, this must be
revisited.

Piece-level questions — "which corner is misoriented?" — need a converter that does not
exist yet. Solve analysis is post-MVP, and the converter is a well-understood 40 lines
when it is needed.

**Risk accepted.** The 24 numbers per face describing which stickers travel where are
hand-derived, and a single reversed strip produces a cube that is wrong in a way that
structural tests cannot see: any consistent set of 4-cycles satisfies "four turns returns
to solved". Three errors of exactly this kind were made while writing the tables, and were
caught by the mitigations below.

## Mitigations

Two layers of testing, because this data is the foundation everything else rests on.

1. **Known cube identities.** `(R U R' U')` six times returns to solved; the T permutation
   is its own inverse; a Sune repeated six times returns to solved. These depend on how
   _different_ faces interact, so they fail if any strip is reversed or misattached. All
   three failed on the first run and located the bug.
2. **An independent geometric derivation.** `permutations.geometry.test.ts` rebuilds every
   quarter turn by rotating 3D sticker coordinates about an axis, and asserts the result
   equals the hand-entered tables. Two derivations by different methods agreeing is much
   stronger evidence than either alone, and it means a future hand-edit fails immediately.

## Alternatives considered

**Piece representation.** The right answer for a solver, and the natural home for future
solve analysis. Rejected for now because the MVP has no solver — scrambles come from
`cubing.js` — and every immediate need points at stickers. A converter can be added
without changing the public interface.

**A 54-character string as the internal type.** Compact and directly comparable, and it is
what solvers exchange. Kept as the _serialisation_ format via `toFaceletString` and
`fromFaceletString`, but not as the internal type, because an array of a six-member union
lets the compiler reject an invalid face where a string would not.

**Mutable state with in-place moves.** Faster, and irrelevant at this scale. Rejected
because replay and undo both depend on old states remaining valid.
