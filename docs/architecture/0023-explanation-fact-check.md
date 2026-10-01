# ADR-0023: A deterministic fact check after the notation gate

## Status

Accepted — 2026-10-01 (proposed 2026-09-30), after a second round of move-role rules and
a fresh measurement on seed 2028 (§5).

Amends [ADR-0022](0022-step-explanation-agent.md), whose "Honest limits" named this as
the next step. ADR-0022 is otherwise unchanged.

## Context

The notation gate (ADR-0021 §6) checks notation, not meaning. A model's text that uses only
the step's moves passes, even if it names the wrong colour, puts a pair at the wrong place,
or gives the wrong count. ADR-0022's live measurement found loose claims of this kind:
one reply counted the rotation `y` among the moves that join the pair, and one gave three
cross edges a single count when each had its own.

Three constraints shape the answer:

- **No second model.** CLAUDE.md keeps deterministic work in normal code. A second model
  to judge the first would cost quota, add latency, and could be wrong in its own ways,
  with nothing to check it.
- **The facts already exist.** Every step carries the facts the model was given, built and
  re-derived by the engine. So checking a claim means comparing it with data we already
  have, not working anything out.
- **A false refusal costs little; a missed wrong claim costs more.** A refused text falls
  back to the template, which is true but plainer. A wrong claim that gets through is shown
  to a learner as fact. But a check that refuses most true text would make the model
  pointless, so false refusals have to be rare too, and measured.

## Decision

### 1. What counts as a checkable claim

The check reads only claims written in a shape it recognises, and compares each with the
step's facts. It does not try to understand a sentence. Wording it cannot read is left
alone: the check can miss a wrong claim, but it is built not to refuse a true one.

**On their own:**

| Claim  | Read as                                                                                                                         | Must be                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Colour | any colour word (`green`)                                                                                                       | a colour some fact mentions                     |
| Place  | a slot phrase (`front right`, `front-right`) or `top/middle/bottom layer`                                                       | a place some fact mentions                      |
| Count  | a number followed, within two words, by `move(s)`, `turn(s)`, `edge(s)`, `pair(s)`, `slot(s)` or `corner(s)`; or `after move N` | one of the numbers the facts give for that noun |

**Tied together**, because a true colour at a true place can still be the wrong pairing:

| Claim         | Example                                    | Must be                                                                                       |
| ------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Pair at place | "the green–red pair at back left"          | a place a fact puts that pair (either grip)                                                   |
| Edge on side  | "the green edge on the front" (cross only) | that edge's side                                                                              |
| Edge timing   | "the green edge … after three moves"       | that edge's `solvedAfter`, for every edge colour since the last timing phrase in the sentence |
| Piece place   | "the corner starts at the top back right"  | `pair-located`'s place, in a clause naming only the corner or only the edge                   |
| Move role     | "R U2 R' joins the corner and edge"        | exactly the joining moves (no rotation), or exactly the inserting moves                       |

The last row goes one step past colours, places and counts. It is a claim about the
step's own notation, which the gate lets through because every move in it is real. It is
here because the development corpus (§5) showed that this, and not a wrong number, is how
ADR-0022's first finding actually appears: "Then R U2 R' joins the corner and edge after
four moves", where the count is right and the four moves are `R U2 R' F'`.

What a run of moves does is read from the words around it:

- **The verb after it**, up to the next run: "R U2 R' joins them". Or, when the run is
  named with "using", "with", "by" or "via", **the verb before it** in the same clause:
  "they are joined after 2 moves using F' L". "Pairs" and "connects" read as joining;
  "the joined pair" and "use L to start joining" do not, because both are true of any
  move.
- **"The remaining moves" or "leaving us with"** right before a run names it as the
  insert, even when it names every move.
- **A run said to join and insert** must run to the end of the step and start no later
  than the move that joins the pair. "U2 sets them up, then F' U' F joins and inserts
  them" is true when `F'` joins them.

A run naming every move of the step with only one verb is a summary and is not checked.
The facts call the whole pair step its insert (`insertLength`), so "R U R' U' finishes
the insert" is true in their own words.

**The numbers a fact allows** include the arithmetic a reader would accept as the same
fact. A pair that joins after 3 of 7 moves allows 3, 7 and 4 ("the last 4 moves"). A cross
allows its count, each edge's `solvedAfter`, and how many moves are left after each.

### 2. Numbers written as words

`zero` to `twenty` are read as numbers, as are digits. That covers every count the solver
produces: a cross is at most 8 moves, and the search stops inserts at 12 (`F2L_LIMITS`). Larger number words,
ordinals ("the sixth move") and phrases such as "a single move" are not read, so a claim
written that way is missed rather than refused.

A bare number is never a claim. "One" is as often a pronoun ("this one is shortest") as a
count, and "two of the moves" says nothing checkable about how many there are. So a
number must be followed by a counted noun, and the search for it stops at punctuation, at
another number, and at words such as "of", "the" and "after". Hyphens are spaces, so
"five-move" reads as "five move".

### 3. Where it lives: `packages/shared`, next to the gate

`checkFacts(text, step, names)` is in `packages/shared/src/solver/fact-check.ts`, and
`chooseExplanation` runs it after `checkNotation`.

- **It is the same kind of thing as the gate:** pure, deterministic, no I/O, and about
  one step's facts. The facts' types live in `shared`, so a new fact kind is a compile
  error here as well as in the template and the prompt builder.
- **It can be held to the template.** The template states only facts, so it must pass.
  The tests run it through the check over the same 120 solves the gate is tested on,
  which is the strongest guard against false refusals there is.
- **The API keeps no rules of its own.** The explainer still calls one function and logs
  what it returns.

The alternative, putting it in the API next to the prompt, would have made it easier to
change with the prompt. But the check is about the facts, not the prompt: a new prompt
must still say true things.

### 4. How it shows up in `Explanation`

A new variant, alongside `refused`:

```ts
| { source: 'template'; text: string; reason: 'contradicted'; mismatches: readonly FactMismatch[] }

interface FactMismatch {
  claim: 'colour' | 'place' | 'count' | 'pair-place' | 'edge-side' | 'edge-timing' | 'piece-place' | 'move-role';
  said: string;              // the words that made the claim, e.g. "orange … after four moves"
  allowed: readonly string[]; // what the facts allow instead, for the log
}
```

- **A separate reason, not a second kind of `refused`,** because the two failures have
  different fixes. A notation refusal means the prompt let the model add a move. A
  contradiction means the model misread a fact, or the check misread the text. Logs
  should tell them apart without opening each one.
- **The gate runs first.** Text that adds a move is `refused`, whatever else is wrong with
  it, because that is the stronger guarantee and the one ADR-0021 promised.
- **The explainer logs a `warn`** ("Explanation contradicted the step facts; using the
  template") with `mismatches` and the text cut to 500 characters, as for a refusal. A
  contradicted text is not cached, so the next request asks again.
- **Nothing new reaches the client.** As with `refused`, the route sends only `source`
  and `text`.

### 5. Measured on real replies

The check was built against a development corpus: one live run of 100 steps (seed 2026),
every reply saved to a file so the check could be replayed without spending quota. Its
first version fired on 10 of the 100. Seven of those were false: a whole step's moves
summarised with one verb, and "U and R'" read as two runs. After both fixes it fired on 3,
all of them real wrong claims about which moves join or insert the pair.

Because the rules were tuned on that corpus, the reported rate comes from a fresh run on
a different seed, below.

Run on 2026-09-30, `gemini-3.5-flash-lite` on the free tier, prompt version 1, 20 seeded
solves (seed 2027) over all six cross faces. Each of the 96 answered replies was then read
by hand against its facts.

| Measure                        | Result                                                         |
| ------------------------------ | -------------------------------------------------------------- |
| Steps                          | 99 (96 answered, 3 timed out at the 6-second deadline)         |
| Refused by the notation gate   | 0                                                              |
| Contradicted by the fact check | **7 (7.3% of answered)**, all on move role                     |
| … of those, really wrong       | **7 of 7.** No reply making only true claims was refused       |
| … logged reason exactly right  | 3 of 7. The other 4 name a different claim (below)             |
| Passed, read by hand           | 89. No wrong colour, place or count among them                 |
| … wrong move role let through  | 5 of 89 (below)                                                |
| Latency per call               | median 720 ms, p95 991 ms (unchanged: the check costs no call) |

Over both runs, 196 replies, the model made **no** wrong colour, place or count claim, and
the lumped cross count ADR-0022 found did not recur. Flash-Lite's mistakes are almost all
of one kind: which moves do which job. So the bindings that matter in practice are the
move-role ones. The colour, place, count and edge bindings guard against mistakes a
different model or prompt may make, and are held to their job by the tests rather than
by this measurement.

**Where the logged reason is wrong.** In 4 of the 7, the reply was wrong but the check
flagged a different claim from the one that was wrong: a verb it does not read as a join
("pairs", "connects"), a verb that comes before the run ("join them using R U2 R2"), and
"use L to start joining", which is true. The fallback was right each time. The log line
pointed at the wrong words.

**What it let through.** Five replies with a wrong move role passed:

- the verb before the run: "joined after 2 moves using F' L U2" (the join is `F' L`);
- a run said to join _and_ insert that is not the whole step: "R U F R F' R join them …
  and insert", with the last move written `R` for `R'`;
- the whole step handed to one part: "the remaining moves U2 R F R F' R'", "leaving us
  with F' U2 F U F' U' F", "U L F' U' F L' are used to complete the insert".

#### Second round: the move-role rules, measured on seed 2028

The product owner asked for the rules these misses suggest, and a fresh measurement.
Replaying both saved corpora while writing them showed the rules as first proposed were
too tight in two places:

- **"Both join and insert" cannot mean "the whole step exactly".** "U2 sets up the
  pieces before F' U' F joins and inserts them" is true when `F'` makes the pair. The rule
  became: a run said to do both must run to the end of the step, starting no later than
  the joining move.
- **"The remaining moves" only names a run right before it.** In "the remaining moves
  finish the insert using y' U R' F R F2 U' F", the run is how the insert is done, and the
  facts call the whole step the insert.

They also showed that one of the five misses cannot be caught by a rule: "Then U L F' U'
F L' are used to complete the insert" names every move with one verb, exactly as the true
summaries do ("Finish the insert with F' U2 F U F' U2 F"). It stays a summary, and is
listed under the limits below. "The joined pair" and "use L to start joining" were taken
out of the join verbs, and "pairs" and "connects" added, so the logged reason names the
claim that was wrong.

On the saved corpora the check now fires on 3 of 100 (dev, unchanged) and 11 of 96 (seed
2027): the 7 it caught before, all now logged with the claim that was wrong, and 4 of the
5 misses.

Run on 2026-10-01, the same model, prompt and settings, on seed 2028. Each contradicted
reply, and the move-role claims of each passing one, were read by hand against the facts.

| Measure                        | Result                                                 |
| ------------------------------ | ------------------------------------------------------ |
| Steps                          | 99 (94 answered, 5 timed out at the 6-second deadline) |
| Refused by the notation gate   | 0                                                      |
| Contradicted by the fact check | **8 (8.5% of answered)**, all on move role             |
| … of those, really wrong       | **7 of 8.** One true reply was refused (below)         |
| … logged reason exactly right  | 7 of 7                                                 |
| Passed                         | 86. No wrong move role among them                      |
| Latency per call               | median 778 ms, p95 2,780 ms                            |

The wrong replies it caught: runs one or two moves off the join (four), a run said to
join and insert that drops the last move, and two that write a move wrong (`U R R'` for
`U R'`, and the whole step with `F` for its last `F'`). Replayed, the check before this
round catches 5 of these 7. The new rules catch the other two.

**The false refusal.** "We use U R F R' F' to join them after 5 moves and place them in
the slot with R'" is true. Reading the verb before "with R'" went back across "and" to
"join", so `R'` was read as a join claim. The before-verb is now read only within its own
clause, which ends at "and" unless the "and" follows a joining verb ("join and insert
them using …"). Replayed, seed 2028 fires on the 7 really wrong replies and nothing else,
and the other two corpora are unchanged.

That fix was made after reading seed 2028, so 7 of 94 is a fitted number, as 3 of 100
was for the dev corpus. The honest measured rate for this round is the table above: 1
false refusal in 94. As ADR-0021 and ADR-0022 do for the gate, the explainer's
`contradicted` warnings are the ongoing measurement; a fourth seed is only worth spending
quota on if the rules change again.

Across 290 replies on three seeds, the model has still made no wrong colour, place or
count claim that the check or a reader found. (For seed 2028, colours, places and counts
were left to the check rather than read by hand.)

## Consequences

**Made easier.** A wrong colour, place, count or move role in the cases above now falls
back to the template instead of reaching a learner. The logs say which claim failed and
what the facts allowed, so a rising rate can be traced to the prompt or to the check.
Saved corpora mean a change to the check can be replayed against real replies for free.

**Made harder.** The check is pattern matching on English. It is about 600 lines of rules
that each need a test, and a new phrasing from a new model or prompt can slip past it. A
rule that is too loose misses claims; one that is too tight refuses true text, and
nothing but the template test and a live measurement shows which.

**Honest limits.**

- It reads claims in the shapes listed in §1, and nothing else. "The pair on the left
  side of the back" or "the sixth move" say something checkable that it does not read.
- Counts are checked against every number the step can truly claim for that noun, not
  against the one the sentence means. "Its insert takes 7 moves", counting the rotation,
  is caught only when 7 is not another true number in the step, such as another pair's
  insert length: 243 of 426 rotated pair steps over 120 solves (57%). Move-role claims
  catch the same mistake when the moves are named.
- Claims about why ("because it is the shortest") are not checked, beyond the counts in
  them. Nor are claims about twist, sticker facing, or what a single move does.
- A run naming every move of a pair step with one verb is taken as a summary, because the
  facts call the whole step the insert. So "they join after 3 moves. Then U L F' U' F L'
  complete the insert", which hands the whole step to the insert, passes. Only the
  sentence before it shows that it is wrong, and the check reads runs one sentence at a
  time.
- The verbs that name a run's job are a list ("join", "connect", "insert", "finish",
  "complete", …). "Place them in the slot" is not on it, so a run named that way is not
  checked.

## Alternatives considered

**A second model as judge.** It would read any phrasing, which the patterns cannot. It
was rejected because it doubles the calls on a free-tier quota, adds a second latency,
and is itself unchecked: it can approve a wrong claim, or refuse a true one, for reasons
no test can pin down. CLAUDE.md keeps deterministic checks in code.

**Structured output: the model returns claims as JSON with its text.** Checking JSON
would be exact. But the model could return true claims and still write a false sentence,
so the text would need checking anyway. It also needs a schema and a second shape of
reply, against ADR-0022's choice of plain text.

**Bag-of-words only: colours, places and numbers each checked on their own.** This was
the smallest version. It cannot catch either of ADR-0022's findings: in both, every
number said was a true number for the step, attached to the wrong thing. The bindings
in §1 are what catch them.

**Prompt changes instead of a check.** The prompt already says "use only the facts
given". A check measures how often that is not enough. Prompt work is still the first fix
if the rate rises, as ADR-0022 says for the gate.
