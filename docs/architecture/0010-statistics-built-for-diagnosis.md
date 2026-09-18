# ADR-0010: Statistics are built for diagnosis, not just reporting

## Status

Accepted — 2026-09-18

## Context

Timing, scrambles, history and averages are commodity features. csTimer has had all of
them for years, is free, and is what most serious cubers already use. Shipping another
statistics page differentiates CubeCoach from nothing.

The product principle is that a timer tells you how fast you solved, and CubeCoach should
tell you _why you are at this level and what to practise next_.

The obstacle is that a total solve time is thin data. "14.2 seconds" says almost nothing
about what to fix, which is precisely why no timer can coach from it. Diagnosis needs
either more data per solve, or more that can be derived from the data already held.

## Decision

Statistics are computed in `packages/shared` as pure functions, and the set deliberately
goes beyond the conventional averages.

**Averages** — ao5, ao12, ao50 and ao100, current and best, following competition rules
exactly. These are table stakes: their absence would be conspicuous, and their presence
differentiates nothing.

**Consistency** — spread, standard deviation, and deviation relative to the mean. Two
cubers with an identical average can need opposite advice: one whose solves cluster
tightly is limited by technique, one who alternates fast and slow is limited by mistakes.
Only the spread distinguishes them, and most timers bury it.

**Cross difficulty** — for every scramble, the exact minimum number of moves to solve the
cross, computed by search. Times are then compared between scrambles with an easy cross
and a hard one.

That last one is the differentiator, and it is available almost for free because of
earlier decisions: the scramble is stored with each solve, and the cube engine can already
represent and manipulate positions. Most timers treat a scramble as an opaque string to
display.

## How cross difficulty is computed

A cross is four edges. The complete state space is 190,080 arrangements, so the problem is
small enough to solve exhaustively rather than approximate.

A breadth-first search runs outward from the solved cross once per face, recording the
distance to every reachable arrangement. Because every move has an inverse, distance is
symmetric — one search answers every future question by lookup instead of repeating work
per scramble. Building a table takes about 90ms; each subsequent query about 0.01ms.

The edge-level move tables are derived from the facelet engine by applying each move to a
solved cube and observing where the pieces went, rather than being written by hand. The
facelet permutations are already verified two independent ways (ADR-0003), so anything
derived from them inherits that confidence instead of adding new data to get wrong.

## Consequences

**Made easier.** The statistics screen can state something no other timer can: _"you
average 12.0 when the cross takes five moves or fewer and 16.5 when it takes more"_. That
is specific, falsifiable, and leads directly to a drill.

It also sets up the AI phase correctly. Deterministic code finds the pattern; the model
explains it and turns it into a practice plan. An AI handed a list of times can only guess
confidently. One handed a measured pattern across several hundred solves has something
real to work with — which is exactly the division of labour `CLAUDE.md` requires.

**Made harder.** The API loads every solve rather than aggregating in SQL, because the
rules — trimmed means, DNFs ranking as the worst time, per-scramble cross difficulty — are
awkward in SQL and already implemented and tested once. That is fine for a personal
history of a few thousand solves and would not be for a hundred thousand. The fix then is
a cached summary updated on write, not a second implementation of the averaging rules.

**A deliberate restraint.** The cross insight is withheld until at least eight solves in
each group. Below that the difference is noise, and presenting noise as a finding is worse
than silence: a cuber who changes their practice because of a fluke has been actively
harmed by the tool. The screen says what it is measuring and that it does not yet know.

## Alternatives considered

**Averages only, matching the established tools.** Less work, and it would make the
product indistinguishable from free alternatives that are better at it.

**Smart-cube integration.** The gold standard for real analysis — per-stage times straight
from the hardware. Rejected for now as hardware-dependent and far beyond the MVP, though
it is the obvious long-term direction.

**Manual stage splits.** Letting a cuber tap once or twice mid-solve to mark cross and
last layer. Much lower effort than smart cubes and probably the highest-value next step
after this, because it turns one number per solve into three.

**Estimating cross difficulty heuristically** — counting how many cross edges are already
placed, say. Cheaper than a search and unreliable in exactly the cases that matter. The
search is fast enough that approximating it would trade correctness for nothing.
