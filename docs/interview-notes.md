# Interview notes

A running list of questions this project has equipped you to answer, added to at the end of
each milestone while the reasoning is still fresh.

Each entry has a plain explanation first and a short version you could actually say out
loud. If you cannot expand one into a two-minute answer in your own words, that is the
signal to go back and re-read the code.

---

## M0 — Repository foundation

### Why a monorepo instead of two separate repositories?

Because the cube engine, the averaging rules and the request shapes are all needed by both
the website and the server. Two repositories would mean either copying that code into both
or publishing it as a package — a lot of ceremony for a project with one developer.

The real risk being avoided is **divergence**. If the rules for calculating an average
existed in two places, they would eventually disagree, and a statistics product that
reports two different numbers for the same thing is worthless.

> "Both the client and the server need the cube logic and the averaging rules. A monorepo
> lets them share one implementation, so the two cannot drift apart."

### Why does the shared package point at src/ instead of a compiled dist/?

Browsers and Node only understand JavaScript, so TypeScript has to be translated first.
Normally a package translates itself once into a dist/ folder and everyone imports from
there.

The problem is that dist/ is a **copy**. Change the original and you have to remember to
regenerate it — forget once, and your app runs the old version while you stare at new code
wondering why your fix did nothing.

Both our apps already contain a translator, so we hand them the original and let them
translate it themselves. No copy means no stale copy.

The cost: this only works because we control both consumers. Publishing the package for
strangers would require adding the build step back.

> "It exports TypeScript source rather than build output, because both consumers already
> compile TypeScript. That removes a build step from the dependency graph and makes stale
> output impossible."

### Why is TypeScript pinned to 6.0.3 when 7.0.2 exists?

TypeScript 7 is a rewrite of the compiler, and typescript-eslint — the tool that lets
ESLint understand TypeScript — does not support it yet. Installing the newest version
silently broke linting.

The general lesson: the newest version of one tool is useless if the tools around it have
not caught up. What matters is the newest version the _whole toolchain_ agrees on.

> "The compiler was not the binding constraint, the ecosystem around it was."

### What does noUncheckedIndexedAccess do?

Normally TypeScript says `myArray[10]` is definitely a value. That is a lie — the array
might only have three items, and you would get `undefined` at runtime. This is one of the
few places the type system is knowingly optimistic.

Turning the flag on makes TypeScript admit it: the result becomes "a value **or**
undefined", and you have to handle both. Mildly annoying, and it matters a lot in the cube
engine where arrays are indexed constantly.

### Why must eslint-config-prettier be last?

ESLint finds problems _and_ historically checked style. Prettier only does style. When they
overlap they fight — Prettier reformats, ESLint complains, forever.

eslint-config-prettier is a list that switches **off** every ESLint style rule, handing
formatting entirely to Prettier. The config is read top to bottom and later entries win, so
it has to come last — like an eraser, it only works after the writing.

### Why --frozen-lockfile in CI but not locally?

package.json says "React 19-ish", which is a range. The lockfile records what was
_actually_ installed — the exact version, plus every sub-dependency.

--frozen-lockfile means "install exactly what the lockfile says; if it disagrees with
package.json, stop and fail." CI wants that, because CI's job is to test the same code you
tested. Locally you want the opposite, because adding a dependency is supposed to update
the lockfile.

> "The lockfile pins exact versions. Freezing it in CI guarantees CI tests the same
> dependency tree I did."

### Why are the CI gates separate steps?

GitHub shows step names in its interface, so a failure is identifiable without opening
logs. The order is also deliberate: formatting and linting take seconds, tests take
minutes, so the cheap checks fail first.

---

## M1 — Cube engine

### How do you represent a Rubik's Cube in code?

Two standard options. **Stickers**: 54 coloured squares, and a move is a fixed reshuffle of
their positions. **Pieces**: 8 corners and 12 edges, each with a location and a rotation —
what actual solving algorithms use.

We chose stickers, because we do not need a solver (the scramble library handles that), we
do need to draw the cube later, and "a move is a fixed shuffle of 54 positions" is
something you can explain in one sentence.

The tradeoff: checking whether a position is physically _possible_ needs the piece view. We
do not need that yet because scrambles come from a trusted generator, not from user input.

> "Stickers, as a 54-element array, with every move stored as a precomputed permutation. It
> maps directly onto rendering and it is trivial to test. Piece-level analysis would need a
> converter, which we will add when solve analysis needs it."

### What is a permutation here?

A lookup table saying where each position gets its new value from. `permutation[2] === 20`
means "after this move, position 2 holds whatever was at position 20."

Storing it as _where each slot gets its value from_, rather than _where each value goes to_,
means applying a move is a single map with no bookkeeping — you build the new array by
reading straight down the table.

### Why derive the other twelve moves instead of writing all eighteen tables?

Only the six clockwise quarter turns are entered by hand. A half turn is that applied
twice; an anticlockwise turn is it applied three times.

Eighteen hand-written tables means eighteen chances to make a typo. Six means six. Less
hand-entered data is less surface area for mistakes — that is the whole reason.

### Why is "four quarter turns returns to solved" not a sufficient test?

**This is the most interesting thing in the milestone.** That test passes for _any_
consistent set of 4-cycles, including completely wrong ones. It checks that a move is
self-consistent, not that it is correct.

Three of the six tables were in fact wrong — strips listed in reverse — and every
structural test passed anyway.

What caught it was testing how _different_ faces interact:

- (R U R' U') repeated six times returns to solved
- The T permutation is its own inverse
- A Sune repeated six times returns to solved

These are known facts about real cubes, and each involves two faces influencing each other,
so a reversed strip breaks them immediately. All three failed on the first run.

A second layer was added afterwards: a test that rebuilds every move from 3D geometry by
rotating sticker coordinates about an axis, and asserts it matches the hand-entered tables.
Two derivations by different methods agreeing is far stronger than either alone.

> "Tests that exercise one operation in isolation can pass on a wrong-but-consistent
> implementation. I added known identities that depend on two faces interacting, and those
> caught three reversed tables the structural tests missed."

### What is property-based testing?

Instead of "for this input, expect this output", you state a rule that must hold for _all_
inputs, and the tool generates hundreds of random cases trying to break it.

Ours: **any sequence of moves, followed by its inverse, returns to a solved cube.** That is
true for every possible sequence, so fast-check generates random ones and checks. It finds
edge cases you would never think to write by hand, and when it fails it shrinks the input
down to the smallest failing case.

### Why does inverting an algorithm reverse the order as well as each move?

Undoing "socks, then shoes" means taking off the shoes first. Reverse the order, and
reverse each individual step.

It is the same rule as (AB)⁻¹ = B⁻¹A⁻¹ for matrices. Forgetting the reversal is the classic
bug, and it produces something that looks plausible and is wrong.

### Why reject lowercase move letters instead of accepting them?

In standard cube notation, lowercase means a _wide_ turn — two layers at once — which this
engine does not implement. Quietly treating `r` as `R` would produce the wrong cube with no
error. Rejecting it is the honest behaviour.

Typographic apostrophes are accepted, though, because people paste algorithms from websites
and rejecting those would just look like a bug.

> "Case is not normalised because lowercase means something different in this notation.
> Silently accepting it would produce a wrong result instead of an error."
