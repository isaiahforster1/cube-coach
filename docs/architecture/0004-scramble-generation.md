# ADR-0004: Use cubing.js for scrambles, behind our own interface

## Status

Accepted — 2026-09-18

## Context

A scramble has to be _fair_: every cube position should be equally likely. Otherwise
practice is skewed, personal bests are not comparable, and the statistics the product is
built around mean less than they appear to.

There are two ways to produce one.

**Random-move** picks random turns and strings them together. It is a few lines of code.
It is also biased: some positions come up far more often than others, and no amount of
filtering out redundant moves fixes that. Competition rules do not accept it.

**Random-state** generates a uniformly random position and then _solves_ it, using the
resulting solution as the scramble. This is what competitions require. It needs a
two-phase (Kociemba) solver — a substantial piece of work, and a well-solved problem with
a mature open-source implementation in `cubing.js`, maintained by the speedcubing
community.

## Decision

Scrambles come from `cubing.js`, reached through a `ScrambleProvider` interface that this
codebase owns.

A second implementation, `createRandomMoveScrambleProvider`, is shipped alongside it. It
filters the obviously redundant sequences — the same face twice, three consecutive moves
on one axis — but it does not pretend to be equivalent.

Every `Scramble` carries a `quality` field of `'random-state'` or `'random-move'`, so the
distinction is visible to callers rather than buried.

`cubing.js` is reached through a dynamic `import()` inside `generate()`, not a top-level
import.

Its output is parsed with our own `parseAlgorithm` rather than trusted.

## Consequences

**Made easier.** Scrambles are competition-quality from day one, at roughly 7ms each after
a ~120ms first call. The fallback provider is synchronous in spirit, deterministic when
given a seeded random source, and needs no WebAssembly — which makes it useful in tests
and as an offline degradation path.

**Made harder.** `generate()` is asynchronous, because running a solver is. The interface
is async for both providers so they stay interchangeable.

**Risk: bundle weight.** The `cubing` package pulls in `three` (about 7 MB) for its 3D
player, which we do not use. Importing only `cubing/scramble` should exclude it, and the
dynamic import keeps even the scrambler out of the initial download. This must be verified
against a real production build in M5 — if tree-shaking does not remove `three`, the
options are a narrower import path or vendoring just the solver.

**Risk: notation mismatch.** If the library emits notation this engine does not implement,
parsing throws immediately rather than silently producing a cube that does not match the
scramble shown to the user. The integration test runs the real generator rather than a
mock precisely to catch that.

## Alternatives considered

**Write our own two-phase solver.** Genuinely interesting, and a good project in its own
right. Rejected because it is weeks of work that produces something already available and
better tested, and it is not what the MVP is about.

**Random-move only, upgrade later.** Tempting because it removes a dependency. Rejected
because scramble quality is not a detail — it is the difference between a practice tool
serious cubers will trust and one they will not. The product principle is that CubeCoach
should explain performance honestly, and biased scrambles undermine that at the source.

**Generate scrambles on the server.** Necessary if solve times were ever competitive or
verified. They are not: this is a personal practice tool, and generating locally means a
scramble is ready with no network round trip. The stored scramble travels with the solve,
so history and analysis are unaffected.
