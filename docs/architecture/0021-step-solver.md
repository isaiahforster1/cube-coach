# ADR-0021: The step solver searches in a fixed frame and speaks in the held one

## Status

Accepted — 2026-09-29

The four choices left open when this was proposed are recorded under
[Decisions made at acceptance](#decisions-made-at-acceptance), together with the timing
prototype that settled the last one.

## Context

The solve-coaching feature needs a solver that does the cross and first two layers the
way a person would, one step at a time, and says why each step is what it is. The AI
writes that explanation. It never chooses a move, and it may only state things the engine
has checked ([CLAUDE.md](../../CLAUDE.md), "AI Architecture").

[ADR-0020](0020-whole-cube-rotations.md) added `x`, `y` and `z` so the solver can say
`y R U R'` rather than `B U B'`. It left one question for this ADR. Once a rotation has
been applied, centres are no longer at home. There are two ways to handle that:

1. **Rotated state.** Apply the rotations to the solver's state for real, and judge
   progress by comparing stickers against the centres.
2. **Fixed frame.** Keep the solver's state unrotated, with centres at home. Record how
   the cube is being held as a separate _frame_, and translate moves into that frame only
   when writing them out.

What already exists matters here:

- `readEdges`, `readCorners`, `EDGE_MOVES` and the cross distance tables in
  `analysis/cross.ts` all name pieces by their labels and slots by position. That is
  correct only when centres are at home.
- `cross.ts` already holds, for each face, the exact distance from every arrangement of
  the four cross edges to solved. It uses the table to count moves. Walking down the same
  table gives an optimal cross, with no new search.
- Everything the solver searches over is typed `Move`. `Record<Move, …>` tables have no
  rotation entries, by design.

## Decision

### 1. The solver works in a fixed frame, and the frame is only used for output

The solver's state is always reached by face turns alone, so every centre is at home and
every existing reader means what it says. The solver searches with `Move`, never
`Rotation`.

How the person holds the cube is a `Frame`: the rotations applied since the scramble.
A frame is derived, not typed in. Apply its rotations to a solved cube and read which
label each held face's centre now shows. Turning the held face `h` is the same as turning
the fixed face whose label is on `h`'s centre. That relabelling is the whole translation,
and it comes straight from `ROTATION_PERMUTATIONS`, which ADR-0020 already verified.

So each step is produced in two parts:

- **Compute** a `Move[]` in the fixed frame.
- **Present** it as `Token[]`: any rotation that changes the frame, followed by the moves
  relabelled into the new frame.

This answers ADR-0020's question: **keep solver state unrotated, and treat rotation as a
change of frame.** Centre-relative judging is still used, but as the independent check
described in section 5, not as the way the solver reasons.

### 2. Orientation for the cross

The person chooses the cross face. The default is `D`, the same as the rest of the
analysis. A setup rotation brings that face to the bottom. It is found by searching the
24 orientations for the shortest rotation that does this, not by a hand-written table.
Ties go to the rotation that keeps the front centre in place, so a `U` cross gets `z2`
rather than `x2`.

### 3. Cross: walk down the existing distance table

From the current arrangement, take any move that lowers the distance by one, until the
distance is zero. The result is optimal by construction, and its length equals
`crossDifficulty` for the same scramble and face. That equality is a test.

Many optimal crosses exist. Ties are broken by an ergonomic cost measured in the **held**
frame: `R`, `U`, `F` and `L` are cheap, and `B` and `D` cost more. This makes the solver
deterministic, and it means the cross a person is shown is one they could perform.

`crossDifficulty(scramble, face)` is split so that the table lookup takes a state. The
scramble-shaped function becomes a thin wrapper. Its behaviour does not change.

### 4. F2L: pick a pair, face it at front right, search a short insert

For each of the remaining unsolved slots:

1. Choose the `y` frame that puts that slot at front-right.
2. Search for the shortest sequence that solves this pair and leaves the cross and every
   already-solved pair intact **at the end** of the step. The pair may be broken in the
   middle, as it is in real inserts.
3. Search with IDA\*. The lower bound is the larger of two values: the cross distance
   (already tabulated) and a new pair table (one corner and one edge, 24 × 24 = 576
   entries, built by breadth-first search in the same way as the cross table).
4. The move set, as held, is `U`, `R`, `F` and `L`, plus the half and inverse turns.
   There is no `B` and no `D`: that is what the `y` rotation is for. `L` lets the solver
   pull out a piece stuck in the front-left slot.

Solve the slot with the shortest insert first, and repeat until all four slots are done.
Among equal lengths, prefer the one that needs no new rotation, then the lower ergonomic
cost. This is **greedy**, not a globally optimal F2L. It is the pair choice a person can
check during a solve ("which pair is quickest right now?"), and "this was the shortest of
the N remaining" is a fact the engine can prove.

Every F2L piece can be reached with this move set: `R` and `L` between them touch all four
slots. The limit is depth, not reach. Taking a piece out of a back slot and then restoring
the solved pairs it disturbed can take more moves than the search allows. Each slot search
therefore has two explicit limits: **12 moves** and **2,000,000 positions visited**. If it
hits either one, the step fails. It does not silently widen its search.
That case is logged and turned into a test fixture. An extraction step is added only once
real scrambles show it is needed.

Moves are counted in HTM (half-turn metric). Rotations are shown but not counted, as is
conventional.

### 5. Verification, to the ADR-0003 standard

The solver and its checker must not share a derivation.

- **Oracle.** Replay the presented `Token[]` with `applySequence` on the real scrambled
  state, so the cube genuinely rotates. After each step, judge it with new predicates
  that compare stickers against the centres: `isCrossSolved`, `isPairSolved` and
  `isFirstTwoLayersSolved`. These use only the 54 stickers and the verified permutation
  tables. They do not use `readEdges`, the distance tables or frame translation. The
  solver reasons in a fixed frame, and the oracle judges in the rotated one, so the two
  checks cannot share the same bug.
- **Translation identity.** For random move lists and frames, the presented tokens
  followed by undoing the frame's rotations must equal the fixed-frame moves applied
  directly.
- **Properties over many seeded random scrambles, on all six cross faces.** The cross
  length equals `crossDifficulty`. Every step keeps every earlier step intact. F2L ends
  solved relative to the centres. No presented step contains `B` or `D` outside the cross.
- **Mutation check.** As in ADR-0020, break the translation on purpose (invert the frame,
  or relabel one face wrongly) and confirm the oracle fails. A test suite that passes on
  the first run has not yet proved anything.

### 6. Explanations are built from facts, and facts are built by the engine

Each step carries a list of `StepFact`, a discriminated union. The engine creates each
fact and a test re-derives it. A `Face` in a fact is only ever a colour. Where something
is, is a `HeldPosition` (`'top'`, `'front'`, …) or a `HeldSlot` (`'front-right'`, …), and
each fact states which grip it is told in:

- `cross-summary` (the cross grip): the move count, the optimal count (always equal), and
  for each cross edge its colour, the side it belongs on, and after how many moves it was
  solved for good.
- `pair-choice` (the grip before the step's rotation, where the choice is made): the
  chosen slot, as held and as colours, the rotation that brings it to front right, and
  the insert length (or the limit reached) for every other unsolved slot.
- `pair-located` (the grip after the rotation, where the moves are performed): for the
  corner, its layer, the two sides it sits between and its twist; for the edge, either
  the top side it is on and its top colour, or the middle slot it is in and whether it is
  solved, flipped in place, or in another slot. Every sticker's colour and facing is
  included too.
- `pair-joined`: after how many moves the corner and edge are next to each other and
  matching on both faces they share, and stay that way. This splits the step into "set up
  and join" and "insert".
- `preserved` (after the rotation): the pairs solved before the step and still solved
  after it.
- `also-solved` (after the rotation), only when non-empty: pairs the insert solved without
  aiming to.

`pair-joined` was proposed as "the move at which they first formed a pair". It counts
the join that lasts instead. When a pair is joined, split and joined again, the split
belongs to the setup, and "first" would put it in the insert. No shortest insert in the
tests has done this. A hand-built move list checks the difference.

The AI receives the tokens and the facts, and nothing else. Its text is checked before it
is shown. Any move notation in it must appear in that step's token list. If it does not,
the text is thrown away and a plain template built from the same facts is shown instead.
The template is also what appears when no model is configured, so the feature works
without AI. The AI agent itself (prompting and provider interface) is outside this ADR.

### Where it lives

The solver goes in `packages/shared/src/solver/`: deterministic code with no I/O,
alongside `analysis/`. The pair table is small, and it is built lazily and cached like
the cross tables.

The performance budget, which the solver must meet before it is merged:

- **Passes when** the 95th-percentile time for one full cross plus F2L is under 200 ms in
  Node, measured over 500 seeded scrambles solved on all six cross faces (3,000 solves).
  The median and the single slowest solve are reported alongside it.
- **Table building is timed separately.** It happens once per process and is cached, so it
  does not count against each solve, but it is reported rather than hidden.
- **The position cap is a safety limit, not a speed target.** It stops one pathological
  scramble from hanging a request, and it fails the step the same way the depth limit
  does.

## Consequences

**Made easier.** Every existing reader and table is reused without change, and none of
them needs to know what a rotation is. A cross on any of the six faces works through the
same code as `D`, because only the frame differs. The one new piece of logic that is easy
to get wrong, translation between frames, is a single relabelling taken from verified
tables. It is also checked by an oracle that works in a different way.

**Made harder.** There are now two ways to talk about the same cube: fixed labels
("the `F` face") and held positions ("front"). Every fact that reaches the AI or the
screen must be in held terms, and mixing the two gives an explanation that is true but
wrong for the reader, which is the risk ADR-0020 described. The mitigation is in the
types: facts store held positions as their own type, separate from `Face`. They are words
(`'front'`), not letters, because TypeScript types are structural: `'F'` as a place and
`'F'` as a colour would be the same type and could stand in for each other. `Frame` is
keyed by the same type, so the solver cannot mix them either.

**Honest limits.** Greedy pair choice is not the shortest F2L, and a restricted move set
can fail on rare trapped-piece cases. Both are stated in the interface rather than hidden,
as ADR-0016 did for its searched algorithms.

**Performance risk, now measured.** The prototype meets the budget about five times over
at the 95th percentile (see below). If the finished solver is slower, the first change to
make is a stronger lower bound (the solved pairs first, then a combined cross-and-pair
table), not a weaker search.

## Decisions made at acceptance

The proposal left these four open. Each is now written into the sections above. This
section records what was chosen and why.

1. **Setup rotation for a `U` cross: `z2`, not `x2`** (§2). `z2` keeps the front colour in
   front and swaps left with right. `x2` swaps front with back as well as top with bottom,
   so a slot named from the scramble ends up somewhere the person has to work out again.
2. **F2L move set: `U R F L` as held, failing loudly** (§4). Accepted as proposed, with the
   wording about trapped pieces corrected. The limit is depth, not reach, and both limits
   are now numbers: 12 moves and 2,000,000 positions.
3. **Pair choice: greedy** (§4). "This pair was the quickest of the ones left" is
   something the engine can prove and a person can check during a solve, which is what
   coaching needs. Looking ahead would save a few moves, but it turns the explanation into
   "this sets up a later pair", which is much harder to check. Multislotting is a later
   feature.
4. **Performance: 200 ms, defined as a 95th percentile** ("Where it lives"). A bare
   "under 200 ms" cannot pass or fail. The definition fixes the sample, the percentile,
   and what is timed separately.

### Timing prototype (step 1)

The prototype was in `packages/shared/src/solver/spike/`. It was removed once step 3
promoted its search and tables into `solver/` (see below). It ran IDA\* for each slot over
`U R F L` as held. The lower bound is the larger of the `D` cross distance and a
576-entry pair table. Pairs are chosen greedily, and the cross is found by walking down
the existing table. Other cross faces are handled by relabelling the scrambled cube so
that face becomes `D`. Every solve is checked on the stickers, separately from the
search. Two deliberate bugs were each caught by those checks: corners left out of the
goal test, and corner twists reversed.

The run used 500 seeded random-move scrambles on all 6 cross faces, 3,000 solves in all,
on Node 24 under Vitest, with depth 12 and the 2,000,000-position cap:

| Measure                          | Median | p95    | p99     | Max     |
| -------------------------------- | ------ | ------ | ------- | ------- |
| Cross + F2L time (ms)            | 6.6    | 38.7   | 76.0    | 129.7   |
| Positions visited, per search    | 3,898  | 49,509 | 328,169 | 627,882 |
| Chosen insert (HTM)              | 6      | 8      | 8       | 9       |
| Insert found by any search (HTM) | 7      | 8      | 9       | 9       |
| F2L total (HTM)                  | 24     | 27     | 28      | 30      |

- Table building, once per process: 90 ms for the cross table and 2.5 ms for all sixteen
  pair tables.
- No slot search failed (0 of 29,892), so neither limit was reached. The longest insert
  found was 9 moves against a limit of 12. The most positions any search visited was
  under a third of the cap.
- Adding the already-solved pairs to the lower bound cut p95 to 33 ms and the maximum to
  122 ms, and changed no solution length. It is not needed yet, and it is the first thing
  to try if the solver gets slower.

What this measurement does not cover:

- The scrambles are random-move, not random-state.
- It was timed on one development machine.
- The slowest solve, at 130 ms, is inside the budget. It is still the number to watch,
  because the p95 target does not limit it.

### The finished F2L, measured (step 3)

The search and pair tables now live in `solver/f2l.ts` and `solver/pieces.ts`. Unlike the
spike, they search in the fixed frame with the cross face taken from the `CrossStep`,
choose the `y` for each slot from the frame, and never relabel the cube. The pair tables
are keyed by the two excluded faces (the cross face and the held back), so there are up to
96 of them instead of 16. The budget is checked by `solver/timing.test.ts`, which runs only
with `SOLVER_TIMING=1`. It uses the same 500 scrambles as the prototype on all 6 faces,
with the same limits, and checks every solve with the sticker oracle.

| Measure                       | Median | p95    | p99     | Max     |
| ----------------------------- | ------ | ------ | ------- | ------- |
| Cross + F2L time (ms)         | 3.5    | 12.1   | 19.4    | 34.6    |
| Positions visited, per search | 3,118  | 45,714 | 139,191 | 676,805 |
| Chosen insert (HTM)           | 6      | 8      | 8       | 9       |
| F2L total (HTM)               | 24     | 27     | 28      | 30      |

- Table building, once per process: 495 ms for all six cross tables and 39 ms for all 96
  pair tables. `prepareF2L(face)` builds one face's tables ahead of the first solve.
- No solve failed (0 of 3,000), and the longest insert was 9 moves.
- The first promoted version met the budget but was slower than the prototype: median
  17 ms and max 159 ms on 100 scrambles, at 155 ns per position against the prototype's
  57 ns. Two changes to the inner loop brought it to 37 ns. Bounds-checked reads became
  plain typed-array reads. The imported tables were copied into locals, because Vitest
  compiles an imported name into a property read on a module object each time it is
  used. Both versions visited exactly the same positions, so the cost was per position,
  not in the search.
- Positions per search differ a little from the prototype because moves are now tried
  cheapest-as-held first, which changes which optimal insert is found first. Lengths are
  unchanged.

### Facts, measured (step 4)

Building the facts reads the stickers once per move of each step. The same timing run as
step 3 gave a median of 4.0 ms, p95 14.0 ms, p99 21.9 ms and max 38.3 ms, against
3.5, 12.1, 19.4 and 34.6 ms without facts. Search statistics and solution lengths are
unchanged, and no solve failed. The budget is still met about fourteen times over at p95.

### The template and the notation gate (step 5)

`solver/explain.ts` holds both halves of the last paragraph of §6.

- **The template** writes one or two sentences per fact, in the step's fact order, and
  adds no reasoning of its own. Colour names are passed in, so the colour scheme stays in
  the interface. It does not mention the cross's setup rotation, because no fact carries
  it; the tokens are shown beside the text.
- **The gate** finds every piece of notation in the text and refuses the text if any piece
  is not exactly one of the step's tokens. It looks for more than the engine performs
  (wide turns, slices, `R3`), so a model that writes `r` or `M` is caught rather than
  ignored. Uppercase turns count even when run together (`RUR'`). Lowercase counts only as
  a word on its own, because "by" and "fly" are spelled from turn letters. `F2L` is
  exempt by name.
- **Which way it fails.** When in doubt it refuses: an all-caps word such as `RED` reads as
  notation. Two cases it misses are known: a move written inside single quotes (`'R'`
  reads as `R'`), and a possessive (`R's`). The prompt will ask for plain notation. The
  cost of a false refusal is only that the template is shown.
- **Checked.** Over 120 solves on all six cross faces, the template never fails the gate.
  The solver's fixed-frame moves, offered in place of the presented ones, are refused on
  550 of the 554 steps where the two differ. The other four are relabellings that happen
  to land only on moves the step also contains. A planted bug that inverted the printed rotation was caught by both the worked
  example and the property.

### Serving the steps (step 6)

`GET /api/v1/solver/steps?scramble=…&crossFace=D` returns the cross and each pair, with
their tokens and the template's text. The web app shows them at `/solver`, and each
history row links there with its scramble.

- **The server writes the text, although the browser could.** The solver is in the shared
  package, and the scramble rating already runs in the browser. The explanation will not:
  the model needs a key the browser must never hold, and the gate has to run where the
  model's text arrives. Serving the template from the same route now means the response
  does not change shape when the model is added. Where its text goes is marked by an
  `undefined` passed to `chooseExplanation`. No provider interface exists until there is a
  provider.
- **GET, open to guests.** Solving changes nothing, and the same question always gets the
  same answer, so the request is safe and idempotent, and a solution is a link. Like every
  feature it needs no account (ADR-0012). Its rate limit is 30 a minute, below the global 300. The solve blocks the event loop for up to about 40 ms, and a model will add cost.
- **The scramble rule is in the contract.** `solverStepsQuerySchema` parses the scramble
  with `parseAlgorithm`, so a rotation or wide turn is refused as `VALIDATION_FAILED`
  before the solver sees it. The page runs the same schema and does not send what it
  would refuse.
- **Colour names moved to the contract.** The server now writes "the green–red pair", so it
  needs the scheme. `STANDARD_COLOUR_NAMES` is in `contracts/solver.ts`, and the web app's
  `FACE_NAMES` is that same object, so the sentence and the stickers beside it cannot
  disagree. A per-user scheme would have to travel in the request.
- **Exported by name.** The package root lists the solver's exports instead of using
  `export *`. The oracle's `isFirstTwoLayersSolved` judges against the centres, and the
  one in `algorithms/` judges a fixed-frame cube. They have the same name but answer
  different questions, so the oracle stays inside `solver/`.
- **Reading the real output found a bug the tests had locked in.** "The pair already
  solved stay solved" was in the worked example's expected text. The verb now agrees, and
  a plural case is tested too.

## Alternatives considered

**Rotated state, judged against centres.** This is option 1 above. Every predicate would
have to look up centres first. Every existing reader would need either a relabelling
wrapper or a rewrite, and a missed wrapper returns wrong answers without failing. The
search would also see 24 copies of each position, one per orientation. Rejected as the
way the solver works, and kept as the oracle, which is where its independence from the
solver is most useful.

**An F2L case table** (the standard 41 cases, each with an algorithm). This is what
people learn in advanced F2L. It is rejected for now for the reason in ADR-0016: every
entry would be hand-entered data, and published algorithms rely on moves this engine
checks less well. Worth revisiting later, using ADR-0016's approach of storing each case
as a position and deriving the rest.

**A beginner method** (cross, then corners, then edges). It is easier to explain, but it
is not what the goal asks for, and it teaches a habit an intuitive F2L solver has to
unlearn.

**Optimal cross and F2L as one search.** This is shorter overall, but no person solves
that way, and one long sequence cannot be explained step by step.

**Letting the model choose or suggest moves.** Ruled out by the project's AI
architecture. Moves are deterministic, and a model that suggests one invalid insert
destroys trust in the rest.
