# ADR-0022: A model rewrites the engine's facts, behind a port, a gate and a budget

## Status

Proposed — 2026-09-29

Four choices are left open for the product owner. They are listed under
[Open questions](#open-questions), each with a recommendation.

## Context

[ADR-0021](0021-step-solver.md) §6 settled what the AI may do for the step solver. It
receives each step's tokens and facts and nothing else. It never chooses a move. Its text
passes a notation gate before anyone reads it, and the template takes over when the text is
refused or when no model is configured. Two things were left for this ADR: the prompt and
the provider interface.

What already exists:

- `chooseExplanation(step, modelText, names)` in `packages/shared/src/solver/explain.ts` runs
  the gate and returns `{ source, text }`, plus `reason` and `unknown` when it falls back.
  `solver.service.ts` passes `undefined` as `modelText` today.
- The route already sends only `source` and `text`. `reason` and `unknown` never leave the
  server.
- `GET /api/v1/solver/steps` has a rate limit of 30 a minute per client, set for CPU cost
  alone. The web app caches each answer with `staleTime: Infinity`, because "the same
  question always gets the same answer".
- Google sign-in shows how the API handles an optional integration. Its variables are
  optional in `config.ts`, and when they are missing the feature is not registered.

Adding a model changes three facts the current design relies on:

1. **Text costs money.** Each model call is paid for, and the route needs no account.
2. **Text can change between calls.** The same prompt can give different wording each
   time.
3. **Text can fail.** The provider can be slow, down, rate-limited or misconfigured, and
   the route must still answer.

## Decision

### 1. Two layers: a provider port, and an agent that owns the prompt

```
solver.service ──► StepExplainer ──► TextModel (port) ──► AnthropicTextModel (adapter)
                   (prompt, gate,                     └─► FakeTextModel (tests)
                    cache, budget, logs)
```

- **`TextModel`**, in `apps/api/src/ai/`, is the only thing a provider must implement:

  ```ts
  interface TextModel {
    readonly id: string; // e.g. 'anthropic:claude-opus-5-5', used in cache keys and logs
    generate(request: {
      system: string;
      prompt: string;
      maxTokens: number;
      signal: AbortSignal;
    }): Promise<string>;
  }
  ```

  It takes text and returns text. It does not know about cubes. Streaming, tools,
  conversation history and structured output are left out until a feature needs them.
  Every provider can support this shape, which is what makes the provider replaceable.

- **`AnthropicTextModel`** is the one adapter. It uses the official `@anthropic-ai/sdk`
  (the new dependency, justified below). A refusal or an empty reply becomes an error, so
  the agent sees a single failure path.
- **`StepExplainer`**, in `apps/api/src/modules/solver/`, is the agent. It builds the
  prompt, calls the model, runs `chooseExplanation`, and handles the cache, the budget and
  the logging. Anything specific to explaining steps lives here, so a second agent later
  (a practice planner, say) reuses `TextModel` and none of this.

Where the model sits is a choice made once, in `app.ts`, the same way Google sign-in is
wired. The key present means `AnthropicTextModel`, the key missing means `null`, and tests
pass a fake. `buildApp` gains a `textModel` option so a test can pass a fake without
network access.

**Why the official SDK and not `fetch`.** CLAUDE.md asks for a clear reason before any new
dependency. Here the SDK gives typed request and response shapes, typed errors that
separate retryable failures (429, 5xx) from permanent ones (400, 401), and timeouts and
retries that are already tested. Writing those by hand would be about 50 lines of
untested code on the path where failures matter most. The adapter is the only file that
imports it.

### 2. The prompt is built from the step alone, in the reader's words

`buildStepPrompt(step, names)` is a pure function. It returns the same text for the same
step, and it is tested like the template.

- **Input:** the step's tokens and its facts. Nothing else goes in: no scramble, no user
  data, no earlier steps and no template text.
- **Colours are named before the model sees them.** In a fact a colour is a `Face`
  (`'F'` means green). Passing `'F'` through would teach the model to write "the F pair",
  which the gate refuses, or worse, to confuse a colour with a turn. The builder replaces
  every colour with its name, taken from the same `ColourNames` the template uses. Held
  positions are already words (`'front-right'`). After this, the only notation in the
  prompt is the step's own token list. A test checks that.
- **The system prompt is fixed and versioned** (`EXPLAIN_PROMPT_VERSION`). It tells the
  model to explain why these moves, using only the facts given. It must write moves
  exactly as listed, separated by spaces, with no quotes around them and no possessive
  (these are the two gaps the gate is known to miss, ADR-0021 step 5). It must not name a
  move that is not in the list, and it has a length limit of about three sentences.
- **One call per step, all in parallel.** One call for the whole solve would be cheaper
  in input tokens, but it needs structured output to split the text back into steps, it
  mixes one step's tokens into another step's text, and one bad step would refuse the
  whole reply. Calling once per step matches the gate, which also works one step at a
  time.
- **Plain text output**, with `maxTokens` of about 400. There is only one field, so
  structured output adds nothing.
- **Prompt caching is not used.** The fixed system prompt is a few hundred tokens, below
  the minimum length the API will cache. It is worth revisiting only if the prompt grows.

### 3. The gate runs on the server, and refusals are logged there

`chooseExplanation` is already the gate. The agent adds logging:

- **Refused:** `warn`, with the step's index and kind, `unknown`, the prompt version and
  the model id, plus the refused text cut to 500 characters (see Open question B). The
  response carries only the template, with `source: 'template'`, exactly as today.
- **Failed** (timeout, provider error, empty reply): `warn`, with the error's class and
  status, never the request headers. The response uses the template. A request never
  fails because the model did.
- **No model configured:** one `info` line at startup, and nothing for each request.

`reason` and `unknown` still never reach the client. A reader cannot act on them, and
showing a refused model text defeats the purpose of refusing it.

### 4. Configuration: optional, explicit, validated at startup

Three new optional variables are added to `config.ts` and `.env.example`:

| Variable                     | Default           | Meaning                                             |
| ---------------------------- | ----------------- | --------------------------------------------------- |
| `ANTHROPIC_API_KEY`          | unset             | Unset means template only. The feature still works. |
| `EXPLANATION_MODEL`          | `claude-opus-5-5` | Model id, so switching model needs no code change.  |
| `EXPLANATION_DAILY_CALL_CAP` | `2000`            | Model calls allowed per process per day (see §5).   |

The adapter receives the key from `config` explicitly. It never uses the SDK's default
lookup, which would also accept `ANTHROPIC_AUTH_TOKEN` or a developer's `ant auth login`
profile. The rule then stays true on every machine: **no key in our environment means no
model.** The key is never logged. The logger has no redaction list yet. It is not added here,
because no code path logs outbound request headers, and an error is logged by its class
and status, never whole.

### 5. Cost and change: what `staleTime` and the rate limit become

**A server-side cache makes the same question give the same answer again.** It is keyed by
`sha256(prompt version, model id, built prompt)`, which is everything that decides the
reply. It lives in memory, is bounded by an LRU of 5,000 entries (a few MB), and holds
only text that passed the gate. Failures and refusals are not cached, so the next request
tries again. Because the key is the prompt and not the scramble, two scrambles that reach
the same step share one explanation. The cache is lost on restart, which is accepted: it
only saves money, and correctness does not depend on it.

**`staleTime: Infinity` stays, for a different reason.** Before, it was right because the
answer could not change. Now the answer can change, but it should not change while
someone is reading it, and fetching again costs money for no gain to the reader. The
server cache means a refetch after the client's cache expires usually gets the same text.
One cost is accepted: if the model failed on the first request, that tab keeps the
template for the rest of the session.

**The route's 30 a minute stays, and a second limit is added.** A limit per client does
not bound total spend, because many clients (or one client using many addresses) add up.
So two limits apply:

- **Per client:** 30 requests a minute (unchanged), which bounds CPU and abuse from one
  source.
- **Global:** `EXPLANATION_DAILY_CALL_CAP` model calls per process per UTC day. Once it is
  reached, every request gets the template until midnight, and one `warn` is logged when
  the cap is hit. Cache hits do not count toward it.
- **Provider side:** a monthly spend limit set in the Anthropic console. The code cannot
  enforce this one, and it is the last line of defence if the process count or the cap is
  wrong.

A rough cost, to be replaced by measured numbers: about 800 input tokens and 150 output
tokens per step, 5 steps per solve. At Opus 5.5 prices ($4 and $20 per million) that is
about $0.006 a step, $0.03 a solve, and about $12 a day at the default cap. Haiku 4.5
($1 and $5) is about a quarter of that.

### 6. Latency: one route, a hard timeout

Step calls run in parallel, each with a 6-second timeout and at most one retry (the SDK's
default is two, and with its default timeout a retry could hold a request for minutes). So
the route answers within about 12 seconds in the worst case and about 1–3 seconds
normally, against 4 ms today. The page already shows a loading state.

Splitting the route in two (steps immediately, explanations after) would show the moves
sooner. That changes the contract and the page, so it is left until the measured
latency justifies it.

### 7. Verification

- **Prompt builder:** the same step gives the same prompt. No `Face` letter appears
  outside the token list. Every fact kind appears. The test uses the ADR-0021 worked
  example.
- **Agent, with a fake `TextModel`:** gated text is used. Refused text falls back and logs
  `unknown`, and the response does not contain it. A thrown error or timeout falls back.
  The second identical call is served from the cache, so the fake is called once. The
  budget stops calls when reached. With no model, the provider is never called.
- **Route:** the existing tests stay as they are (no model means the template). One new
  test injects a fake that returns a refused text for one step and checks that neither the
  text nor `unknown` appears in the response body.
- **Live measurement, opt-in** (`EXPLANATION_LIVE=1`, like `SOLVER_TIMING=1`): real calls
  over 20 seeded solves on all six faces, reporting the refusal rate, the notation it
  refused, the tokens used, the latency and the cost. The results are recorded here, as
  ADR-0021 recorded its timing. **Passes when** refusals stay under 5% of steps. If they
  do not, the prompt is changed, not the gate.

## Open questions

- **A. Model.** The default is `claude-opus-5-5` at low effort, the most capable current
  model. The alternative is `claude-haiku-4-5`, at about a quarter of the cost and faster.
  The task only rewrites facts that have already been checked, and the gate catches the
  worst mistake. _Recommendation: start with Opus 5.5 for the live measurement, run the same
  measurement on Haiku, and choose from the refusal rate and cost._ It is one environment
  variable either way.
- **B. Log the refused text?** It contains no personal data, since it comes from a
  scramble and facts, and it is the only way to tell why the prompt failed. _Recommendation:
  yes, cut to 500 characters._
- **C. Anthropic's server-side refusal fallback.** For Opus 5.5 the API can re-run a request
  on another model if the safety classifier declines it. Here a decline already falls back
  to the template, and the option is specific to one provider, so it does not belong behind
  the port. _Recommendation: do not use it._
- **D. The daily cap.** 2,000 calls is about 400 solves a day. _Recommendation: keep it
  until real traffic exists, and set the console spend limit to match._

## Consequences

**Made easier.** A second provider means one new adapter file. A second agent reuses the
port and adds its own prompt. The feature still works with no key, in CI and on a fresh
clone. Cost has three limits, and the one the code cannot enforce is named rather than
assumed.

**Made harder.** The route is now slow, can fail partway through, and costs money. It
depends on a network service, and the cache is state that disappears on restart. Two
processes each keep their own cache and cap, so the real cap is the per-process cap times
the number of processes. This is fine on the current single instance, and it has to be
revisited when the API scales out.

**Honest limits.** The gate checks notation, not meaning. A model can still say a pair is
at front left when the facts say back left, and nothing catches that except the prompt and
someone reading the text. Checking claims (colours and places named in the text against
the facts) is possible and is the next step if the live measurement shows it happens.

## Alternatives considered

**Calling the model from the browser.** Rejected in ADR-0021 step 6: the key would be
public, and the gate would run where it can be bypassed.

**A provider abstraction library** (LangChain, the Vercel AI SDK). It gives many providers
behind one interface, but it is a large dependency for a one-method port, and its
abstractions (chains, tools, memory) are ones this feature does not use. The port here
takes about 10 lines to implement for a new provider.

**Storing explanations in the database.** This would survive restarts and be shared across
instances. It needs a migration, invalidation when the prompt version changes, and a
decision about stored model output. The in-memory cache answers the cost question for now,
and the key already includes the prompt version, so moving the cache to the database later
changes where it is stored, not what it stores.

**Generating once, when a solve is saved.** This takes cost off the request path, but the
solver page accepts any scramble, not only saved solves, and would still need a path for
requests made on demand.

**Sending the template to the model to rewrite.** The prompt would be shorter and the
wording closer to the template. It was rejected because it anchors the model to the
template's phrasing, and because the template is itself derived output. The model should
work from the same facts as the template, not from another explanation of them.
