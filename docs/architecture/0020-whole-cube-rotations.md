# ADR-0020: Whole-cube rotations are a separate kind of move

## Status

Accepted — 2026-09-29

## Context

The next feature is a step solver that solves the cross and first two layers the way a
person would, and explains each step from facts the engine has checked. The AI writes
the explanation. It never chooses the moves.

People solve F2L by turning the whole cube so the slot they are working on is at front
right, and then using the same few inserts again. A solution that never rotates is
correct but hard to follow. You end up doing `L' U L` as a mirror image, or `B U B'` with
your hand behind the cube. Those are not the moves anyone would teach. To explain steps
the way a coach would, the engine has to express `y`, and `x2` for moving the cross to
the bottom.

[ADR-0003](0003-cube-state-representation.md) and [ADR-0016](0016-cases-are-positions.md)
both note that the engine has no rotations. Two facts about the current code limit how
rotations can be added:

1. **`Move` means "one of 18 face turns" everywhere.** `Record<Move, …>` tables in
   `analysis/cross.ts` and `analysis/edges.ts` must list every member. The web renderer's
   `faceOf(move)` returns `move[0] as Face`. Scrambles are stored as `Move[]`. If `x`
   joined the `Move` union, every one of those places would have to change, and the cast
   in `faceOf` would compile while giving a wrong answer.
2. **Every state today has its centres at home.** `isSolved` relies on this, and says so.
   The edge and corner readers identify a piece by its sticker labels and a slot by its
   position. The optimal-cross search assumes the `D` cross belongs on the `D` face. A
   rotation is the first operation that moves centres.

## Decision

**A rotation is a separate type, `Rotation = x | y | z` with the usual `''`, `'` and `2`
suffixes, not a new member of `Move`.** Code that needs both uses `Token = Move | Rotation`.
Every function that takes `Move[]` today keeps that type. The compiler therefore proves
that scrambles, the algorithm library, the cross search and the renderer never receive a
rotation. Rotations can only appear where a signature asks for them.

**A rotation is a 54-sticker permutation, applied just like a face turn.** `x` turns the
whole cube in the direction of `R`, `y` in the direction of `U`, and `z` in the direction
of `F`, as in standard notation. The state really does rotate, so a cube drawn after `y`
looks the way the person is holding it.

**Rotations are built from existing pieces, not typed in as new tables.** A quarter
rotation is three layer turns done together. For example, `x` is `R`, then `L'`, then the
middle layer turning with `R`. The face turns already exist. The middle layer needs new
data, but only 12 numbers per axis: four strips of three stickers, in the same format as
the existing `ADJACENT_STRIPS`. Half and inverse rotations are derived by composition, the
same way face turns are. Slice moves (`M`, `E`, `S`) are not exposed. There is no current
use for them.

**`isSolved` stays strict.** A timer should not count a cube that is solved but rotated as
solved. The comment that says rotations cannot occur is updated. A new function,
`isSolvedUpToRotation`, checks that every face is a single colour. The solver will judge
"is this step done" by comparing stickers against the **centres**. It will not compare
them against home labels.

**Notation.** `parseAlgorithm` still accepts face turns only, because it feeds scrambles
and stored data. A new `parseSequence` also accepts `x`, `y` and `z`. `invertSequence`
inverts sequences that contain rotations. Lowercase `x`, `y` and `z` are standard notation
for rotations, so they do not break the rule that a lowercase letter means an unsupported
wide turn. `r` and `u` are still rejected.

## Testing, to the ADR-0003 standard

The middle-layer strips are new hand-entered data, so both layers of protection apply.

1. **Structural.** Each of the nine rotations is a bijection on 54 positions. Each moves
   exactly 52 stickers, because only the two centres on its axis stay put. Four quarter
   turns give the identity, and three quarter turns equal the prime.
2. **An independent geometric derivation.** `permutations.geometry.test.ts` already builds
   face turns by rotating sticker coordinates in the one layer where `position · axis = 1`.
   A rotation is the same calculation applied to all three layers. The hand-built
   rotations must equal that result. A direction guard, "`x` carries the front face to
   the top", catches a mirror-image error.
3. **Identities that involve different faces.** Conjugation must hold for all 18 pairs of
   rotation and face, for example `x U x' = F` and `y F y' = R`. One reversed strip in a
   middle layer breaks some of these even when every structural test passes. Beyond that:
   `x2 y2 z2` is the identity; the rotations reach exactly **24** orientations of a solved
   cube, which is the order of the cube's rotation group; and a property test checks that
   any mix of turns and rotations followed by its inverse returns to solved.

## Checking that the tests catch errors

All the tests passed on the first run, so passing proved nothing on its own. As a check,
one middle-layer strip on each axis was reversed in turn, and the tests were run against
each broken version.

Each broken version failed exactly five tests: the geometric derivation for that axis,
and the four conjugation identities for the faces that axis moves. **None of the
structural tests failed, and neither did the 24-orientation count.** A reversed strip is
still a rigid permutation made of four-cycles. The cube is turned the right amount; only
some stickers end up in the wrong place. This is the lesson ADR-0003 recorded for face
turns, now confirmed for rotations: the structural checks catch broken bookkeeping, and
only a derivation made a different way, or an identity involving more than one face,
catches wrong data.

## Consequences

**Made easier.** The solver can say `y` and then `R U R'`, as a coach would. It can also
explain what it did in the frame the person is holding. A single conjugation identity
translates any face turn between frames.

**Made harder.** Rotation brings in states whose centres are not at home. The type system
keeps rotations out of existing code paths, but not the states rotations produce: nothing
stops a rotated `CubeState` from being passed to `readEdges` or `crossDifficulty`. The
readers still work. They report pieces by label and slots by position, which is correct
but easy to misread. Code that asks "is this piece home?" must compare against the centres.
The solver ADR has to address this directly. One option is to read pieces relative to the
centres. Another is to keep the solver's own state unrotated and treat rotation as a
change of frame.

**Not done here.** The web renderer cannot animate a rotation yet (`geometry.ts` assumes a
face layer). Showing solver output on the 3D cube needs that later.

## Alternatives considered

**Add `x`, `y` and `z` to the `Move` union.** One type and one parser. Rejected because it
would push rotations into every face-turn table and every stored scramble type. Some of
those places would compile and still be wrong (`faceOf`).

**Virtual rotations only.** The state never rotates. The solver keeps track of how the cube
is held and rewrites `y R` as `F` internally. This fits the "centres are fixed" assumption
perfectly, and may still be the right way for the solver to work internally. Rejected as
the _only_ mechanism, because the person must also be able to see the cube the way they
hold it. The conjugation identities make the two views provably the same.

**Enter each rotation as a hand-typed 54-entry table.** Simple. But 162 hand-entered
numbers across the three axes is more room for error than 36 numbers composed with face
turns that have already been verified.

**Derive rotations only from geometry at runtime.** The geometry code currently exists only
in a test, where it serves as the independent check. Moving it into production would leave
the tables with nothing independent to be checked against.
