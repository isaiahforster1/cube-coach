# ADR-0016: A last-layer case is a position, not an algorithm

## Status

Accepted — 2026-09-19

## Context

The algorithm library is the first feature where being _wrong_ is worse than being
missing. A timer that miscounts is annoying; a library that teaches an algorithm which
does not work wastes someone's practice and they will blame themselves before they blame
the site.

Every algorithm site stores the same three things per case: a name, a move sequence, and
a picture of the case. All three are typed in by hand, and nothing checks that they agree.

That is a problem here for a specific reason: the algorithms could not be copied from
anywhere. This engine has no wide turns, slice moves or whole-cube rotations
([ADR-0003](0003-cube-state-representation.md)), and most published algorithms lean on
them heavily. Every sequence had to be written in plain face turns, from memory, with no
reference to check against.

## Decision

Store the algorithm. Derive everything else.

A case is defined as a **permutation of the last layer** — which of the four corners and
four edges sits in each slot — and the position shown to the reader is computed by running
the algorithm backwards from a solved cube. There is no sticker diagram, and no stored
picture that can drift out of step with the moves.

The library then becomes checkable, and the tests are the real content of this decision:

- Every algorithm, run backwards, must leave the first two layers solved and the top face
  finished. A single mistyped move almost always breaks this.
- Every algorithm must actually solve the position it claims to.
- No two entries may be the same case — which, by eye, is invisible.
- Each case must be filed under the family the engine computes, not the one claimed.
- The 21 entries must cover **every** case that can exist.

## Counting the cases rather than looking the number up

The last claim is the one worth the most. With everything below the top layer solved and
the top face finished, the only freedom left is how four corners and four edges are
arranged, and those two permutations must have matching parity because every face turn is
a four-cycle of each. That is 288 positions.

Two of those positions are the same _case_ when a cuber would use the same algorithm:
when they differ by adjusting the top layer first, or by holding the cube a quarter turn
round. Collapsing by both gives **22 classes — 21 cases and the solved cube**, which is the
familiar number arrived at without anyone having to remember it.

So "is the library complete?" is answered by the engine rather than by counting the rows.

## What the tests actually caught

Two algorithms were wrong, and neither was obvious.

The **E perm** failed outright — it did not preserve the layers below. Worse, the
replacement was built on a wrong belief: that E swaps diagonally opposite corner pairs. The
engine put that position in the same class as the H perm, which is correct and surprising —
a diagonal double swap with solved edges really is an H perm after turning the top layer
twice. E swaps _adjacent_ pairs. That is a fact about the cube that was neither remembered
nor looked up; it fell out of the classification.

The **Z perm** was a duplicate. The sequence was fine, and it produced a U perm.

Neither would have been noticed by reading the code.

## Finding the two missing algorithms

Rather than guess again, the two missing cases were searched for: a meet-in-the-middle over
sequences of R, U and F turns — every position reachable in eight moves from solved, every
position reachable in seven from the target, and the shortest pair that meet. The results
are 14 and 15 moves, longer than the published algorithms but expressible in this engine
and verified by the same tests as everything else.

The search is not shipped. It was a one-off, and its output is now data.

## Consequences

**The picture cannot lie.** It is the algorithm, drawn. The same is true of the family
heading and of the description of what each case moves: all computed.

**Naming is the one thing not verified.** The engine can prove that a case is a corner
three-cycle and that it is distinct from every other; it has no way to know that cubers
call that one `Aa` rather than `Ab`. The labels follow the usual convention and are the
part of this library most worth a second pair of eyes.

**The algorithms are honest rather than optimal.** They are not the ones a speedcuber would
drill, because the ergonomic ones need moves this engine does not have. Two are noted in
the interface as having been found by search rather than taught.

**Corner reading had to be added.** The engine could already read edges; cases need both.
The hand-entered part is the clockwise ordering of each corner's three stickers, checked by
the rule that every move leaves the total twist divisible by three — an invariant of the
physical cube that fails immediately if any corner is listed the wrong way round.

## Alternatives considered

**Copy a published algorithm set.** The obvious answer, and unavailable: the good sets are
written with slice moves and rotations, and translating them by hand is exactly the
error-prone step this decision exists to avoid.

**Store a sticker diagram per case**, as most sites do. Twenty-one hand-drawn pictures that
nothing checks, in a feature where a wrong picture is a wrong lesson.

**Solve each case with a general solver** and generate algorithms automatically. Attractive,
and it needs a real two-phase solver; the meet-in-the-middle search used for two cases does
not scale to arbitrary depth. Worth revisiting if the library grows to the 57 orientation
cases.
