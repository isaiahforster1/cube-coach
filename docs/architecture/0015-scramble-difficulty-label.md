# ADR-0015: Label scramble difficulty by optimal cross length

## Status

Accepted — 2026-09-19

## Context

Two solves ten seconds apart can be the same quality of solve. One scramble hands over a
three-move cross; the next needs seven moves before the solve has properly begun. Until
now the only way to know which you had was to be good enough to see it — which is exactly
backwards, because the people who cannot see it are the ones whose times it distorts most.

This is the product principle in miniature: a timer tells you how fast you solved, and
CubeCoach is supposed to help you understand why.

## Decision

Show a one-word label next to the scramble — **Easy**, **Standard** or **Hard** — with an
info tip that states exactly what was measured.

The measurement is the optimal cross length, computed by the search already built for
[ADR-0010](0010-statistics-built-for-diagnosis.md), on the default cross face.

## Why the cross

It is the only part of a solve the scramble fully determines. Everything after the cross
depends on choices the solver makes and on methods they may not use; the cross is a fixed
cost, and it is exactly computable rather than estimated.

So "hard" is a precise claim — this cross cannot be done in fewer than seven moves — not a
vibe. The interface says so rather than leaving "hard" to mean whatever the reader
assumes, and it explicitly says the label covers nothing beyond the cross.

## Where the thresholds came from

Measured, not chosen by feel. Optimal cross length over a large sample of random cubes,
on one face:

| Cross moves | Share |
| ----------- | ----- |
| ≤ 4         | ~7%   |
| 5           | ~26%  |
| 6           | ~50%  |
| 7           | ~17%  |
| 8           | ~0.1% |

So the tails are the informative part: `≤ 4` is easy, `≥ 7` is hard, everything else is
standard. About one scramble in fourteen is easy and one in six is hard.

A label is only worth showing when it distinguishes this scramble from the last one. If
every second scramble were called hard, the word would stop carrying information and
people would correctly stop reading it. A test asserts the shares stay in that range, so
a future change to a threshold cannot quietly make the label meaningless.

Note this is a _different_ split from the one the cross-difficulty insight uses. That one
cuts solves into two groups of comparable size because it is doing statistics and needs
both groups populated; this one names outliers. Same measurement, two jobs, and the
constants live apart so neither can be "tuned" into the other.

## One face, not the best of six

A colour-neutral solver takes whichever cross is shortest, so the best-of-six number would
describe them better. Most people solve one colour, and telling them a scramble is easy
because some _other_ face has a two-move cross would be worse than saying nothing. The
rating reports which face it measured, so the claim stays checkable.

## Consequences

**Made easier.** Times become interpretable. Combined with the existing cross-difficulty
insight in the statistics — which compares your times on easy and hard crosses — a cuber
can see both the per-solve context and the pattern across a session.

**The cost.** The first rating on a page builds a breadth-first search over every
reachable cross position, roughly a tenth of a second. Every rating afterwards is a table
lookup.

A tenth of a second is short and still too long to spend before showing someone their
scramble, so the rating is computed after the first paint and the label appears a moment
later. The scramble is readable throughout, which is what actually matters. A web worker
would take it off the main thread entirely and is the right answer if this grows; it is
more machinery than one tenth of a second deserves today.

**What it does not do.** It says nothing about the rest of the solve. A scramble with a
four-move cross and an unpleasant F2L will be labelled easy, and the tooltip admits it.

## Alternatives considered

**God's number / optimal full solve length.** The honest measure of "how hard is this
scramble", and near-useless here: it requires a full two-phase solver, it measures a solve
no human performs, and almost every random cube is 17–20 moves, so the number barely
varies.

**Counting moves in the scramble.** Free, and meaningless — scramble length is fixed by
the generator and says nothing about the position it produces.

**Showing the raw number instead of a word.** "Cross: 7" is more precise and needs the
reader to already know what counts as a lot. The word is the summary and the number is in
the tooltip, which serves both readers.

**Rating after the solve rather than before.** Avoids any suggestion of an excuse in
advance. Rejected: knowing the scramble is hard _before_ inspecting is useful practice
information, and the same number already appears in the statistics afterwards.
