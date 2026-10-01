# ADR-0022: A model rewrites the engine's facts, behind a port, a gate and a budget

## Status

Accepted — 2026-09-30 (proposed 2026-09-29). Amended by the proposed [ADR-0023](0023-explanation-fact-check.md), which adds the fact check its "Honest limits" names as the next step.

The four open questions were answered by the product owner. The answers, and one change
they forced, are under [Decisions on the open questions](#decisions-on-the-open-questions).
The change: the proposal assumed a paid Anthropic adapter. The product owner does not want
to pay for model calls, and wants explanations to keep working when their own computer is
off. So the one adapter is for **Google's Gemini API on its free tier**, called with plain
`fetch`. Everything else in the proposal is unchanged, because it was written against the
port and not the provider.

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

1. **Text has a cost.** On a paid plan each call is money. On a free tier each call uses up
   a daily quota. Either way the route needs no account, so anyone can spend it.
2. **Text can change between calls.** The same prompt can give different wording each
   time.
3. **Text can fail.** The provider can be slow, down, rate-limited or misconfigured, and
   the route must still answer.

## Decision

### 1. Two layers: a provider port, and an agent that owns the prompt

```
solver.service ──► StepExplainer ──► TextModel (port) ──► GeminiTextModel (adapter)
                   (prompt, gate,                     └─► FakeTextModel (tests)
                    cache, budget, logs)
```

- **`TextModel`**, in `apps/api/src/ai/`, is the only thing a provider must implement:

  ```ts
  interface TextModel {
    readonly id: string; // e.g. 'gemini:gemini-3.5-flash-lite', used in cache keys and logs
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
  A failure is a `TextModelError` with a `kind` (`timeout`, `rate-limited`, `unavailable`,
  `rejected`, `blocked`, `empty`) and the HTTP status when there is one, so the agent sees
  one failure path whatever the provider.

- **`GeminiTextModel`** is the one adapter. It calls the Gemini REST API with `fetch`.
  A blocked prompt, a reply cut off at the token limit, or an empty reply becomes an
  error. It asks for minimal thinking, because rewriting checked facts needs none, and it
  drops any thought parts from the reply.
- **`StepExplainer`**, in `apps/api/src/modules/solver/`, is the agent. It builds the
  prompt, calls the model, runs `chooseExplanation`, and handles the cache, the budget and
  the logging. Anything specific to explaining steps lives here, so a second agent later
  (a practice planner, say) reuses `TextModel` and none of this.

Where the model sits is a choice made once, in `app.ts`, the same way Google sign-in is
wired. The key present means `GeminiTextModel`, the key missing means `null`, and tests
pass a fake. `buildApp` gains a `textModel` option so a test can pass a fake without
network access. The test context passes `null` unless a test asks for a fake, because the
tests load the developer's `.env`, which may hold a real key.

**Why `fetch` and not Google's SDK.** The proposal chose Anthropic's SDK for typed errors
and tested retries. Both reasons are weaker here. The adapter makes one kind of request,
the error cases that matter are four HTTP statuses and three reply shapes, and the retry
policy is deliberately narrower than an SDK's (below). That is about 80 lines with tests,
against a new dependency. CLAUDE.md asks for a clear reason before adding one, and there
is not one.

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
  prompt is the step's own tokens. A test checks that.
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
- **Plain text output**, with `maxTokens` of 400. There is only one field, so structured
  output adds nothing.
- **Prompt caching is not used.** The fixed system prompt is a few hundred tokens, too
  short to be worth caching. It is worth revisiting only if the prompt grows.

### 3. The gate runs on the server, and refusals are logged there

`chooseExplanation` is already the gate. The agent adds logging:

- **Refused:** `warn`, with the step's index and kind, `unknown`, the prompt version and
  the model id, plus the refused text cut to 500 characters (decision B). The response
  carries only the template, with `source: 'template'`, exactly as today.
- **Failed** (timeout, provider error, empty reply): `warn`, with the error's kind and
  status, never the request headers. The response uses the template. A request never
  fails because the model did.
- **No model configured:** one `info` line at startup, and nothing for each request.

`reason` and `unknown` still never reach the client. A reader cannot act on them, and
showing a refused model text defeats the purpose of refusing it.

### 4. Configuration: optional, explicit, validated at startup

Three new optional variables are added to `config.ts` and `.env.example`:

| Variable                     | Default                 | Meaning                                                  |
| ---------------------------- | ----------------------- | -------------------------------------------------------- |
| `GEMINI_API_KEY`             | unset                   | Unset (or empty) means template only. The feature works. |
| `EXPLANATION_MODEL`          | `gemini-3.5-flash-lite` | Model id, so switching model needs no code change.       |
| `EXPLANATION_DAILY_CALL_CAP` | `450`                   | Model calls allowed per process per UTC day (see §5).    |

The adapter receives the key from `config` explicitly and sends it in the
`x-goog-api-key` header, never in the URL, where it would end up in proxy and access logs.
The rule stays true on every machine: **no key in our environment means no model.** The
key is never logged. The logger has no redaction list yet. It is not added here, because
no code path logs outbound request headers, and an error is logged by its kind and
status, never whole.

The key belongs to a Google Cloud project with **no billing account linked**. That is what
makes the free tier a hard limit: past the quota, Google refuses the call with a 429, and
nothing is charged. Linking billing to that project would move the key to a paid tier
silently, so `docs/deployment.md` says not to.

### 5. Cost and change: what `staleTime` and the rate limit become

**A server-side cache makes the same question give the same answer again.** It is keyed by
`sha256(prompt version, model id, built prompt)`, which is everything that decides the
reply. It lives in memory, is bounded by an LRU of 5,000 entries (a few MB), and holds
only text that passed the gate. Failures and refusals are not cached, so the next request
tries again. Because the key is the prompt and not the scramble, two scrambles that reach
the same step share one explanation. The cache is lost on restart, which is accepted: it
only saves quota, and correctness does not depend on it.

**`staleTime: Infinity` stays, for a different reason.** Before, it was right because the
answer could not change. Now the answer can change, but it should not change while
someone is reading it, and fetching again uses quota for no gain to the reader. The
server cache means a refetch after the client's cache expires usually gets the same text.
One cost is accepted: if the model failed on the first request, that tab keeps the
template for the rest of the session.

**The route's 30 a minute stays, and a second limit is added.** A limit per client does
not bound the total, because many clients (or one client using many addresses) add up.
So three limits apply:

- **Per client:** 30 requests a minute (unchanged), which bounds CPU and abuse from one
  source.
- **Global:** `EXPLANATION_DAILY_CALL_CAP` model calls per process per UTC day. Once it is
  reached, every request gets the template until midnight UTC, and one `warn` is logged
  when the cap is hit. Cache hits do not count toward it. Failed calls do, because the
  provider counts them too.
- **Provider side:** the free tier's own quota (decision D). The cap sits just under it, so
  the app falls back by its own rule instead of collecting 429s, and if the cap were wrong
  the quota still stops it at no charge.

Free tiers also limit requests per minute. A solve is about five parallel calls, so a
burst of solves can be refused with a 429 inside the daily quota. That falls back to the
template like any other failure. If it happens often in practice, the fix is a small queue
in the agent, not a change to the route.

A rough size, to be replaced by measured numbers: about 800 input tokens and 150 output
tokens per step, 5 steps per solve. The free tier charges nothing for that; what it
limits is the count. At 450 calls a day that is about 90 solves a day.

### 6. Latency: one route, a hard deadline

Step calls run in parallel. Each has one 6-second deadline that covers any retry, so the
route answers within about 6 seconds in the worst case and about 1–3 seconds normally,
against 4 ms today. The page already shows a loading state.

The adapter retries once, and only on a network error or a 5xx, while the deadline has
time left. It does not retry a 429: on a free tier that usually means the quota is spent,
and asking again only spends more of it.

Splitting the route in two (steps immediately, explanations after) would show the moves
sooner. That changes the contract and the page, so it is left until the measured
latency justifies it.

### 7. Verification

- **Prompt builder:** the same step gives the same prompt. No `Face` letter appears
  outside the token list. Every fact kind appears. The test uses real solver output.
- **Adapter, with a stubbed `fetch`:** the request shape, the key in a header, the thought
  parts dropped, each failure mapped to its kind, one retry on 5xx and none on 429.
- **Agent, with a fake `TextModel`:** gated text is used. Refused text falls back and logs
  `unknown`, and the response does not contain it. A thrown error or timeout falls back.
  The second identical call is served from the cache, so the fake is called once. The
  budget stops calls when reached. With no model, the provider is never called.
- **Route:** the existing tests stay as they are (no model means the template). One new
  test injects a fake that returns a refused text for one step and checks that neither the
  text nor `unknown` appears in the response body.
- **Live measurement, opt-in** (`EXPLANATION_LIVE=1`, like `SOLVER_TIMING=1`): real calls
  over 20 seeded solves spread over all six faces, reporting the refusal rate, the
  notation it refused, the tokens used and the latency. The results are recorded here, as
  ADR-0021 recorded its timing. **Passes when** refusals stay under 5% of steps. If they
  do not, the prompt is changed, not the gate.

## Decisions on the open questions

- **A. Model: `gemini-3.5-flash-lite`, free tier.** Not Opus 5.5 or Haiku 4.5, because
  the product owner will not pay for calls, and not a local model through Ollama, because
  it would only work while their computer is on. On this key's free tier, Gemini 3.8 Flash
  allows 20 requests a day, which is about four solves and too few for the live
  measurement. Flash-Lite allows 500. The model id is pinned, not the `-latest` alias, so
  a measurement can be repeated against the same model. Switching is one variable.
- **B. Log the refused text: yes, cut to 500 characters.** It contains no personal data,
  since it comes from a scramble and facts, and it is the only way to tell why the prompt
  failed.
- **C. A provider's server-side fallback: not used.** The question was about Anthropic's
  option to re-run a declined request on another model. The provider is now Gemini, but
  the reasoning holds for any such option: a decline already falls back to the template,
  and a provider-specific behaviour does not belong behind the port.
- **D. The daily cap: 450.** Just under the free tier's 500 requests a day for Flash-Lite,
  so the app's own cap is reached first. It has to be lowered to match if the model is
  switched to one with a smaller quota.

## Live measurement

Run on 2026-09-30, `gemini-3.5-flash-lite` on the free tier, prompt version 1, 20 seeded
solves (seed 2026) spread over all six cross faces, calls spaced 4.5 seconds apart.

| Measure                  | Result                                    |
| ------------------------ | ----------------------------------------- |
| Steps                    | 100                                       |
| Answered                 | 99 (1 timed out at the 6-second deadline) |
| Refused by the gate      | **0 (0.0%)** — passes, the limit is 5%    |
| Latency per call         | median 733 ms, p95 1,237 ms, max 2,045 ms |
| Tokens per answered step | 886 input, 58 output, 0 thinking          |
| Quota used               | 100 of 500 requests for the day           |

The estimate in §5 (800 in, 150 out) was close on input and high on output: replies are
two to three sentences. Calls in parallel put a typical solve at about one second.

**Reading the samples for meaning** (the gate's honest limit) found wording that is
loose rather than false: one reply counted the rotation `y` among the moves that join the
pair, and one ran three cross edges into a single "solved after five moves" when the facts
give each its own count. Neither names a wrong move. Both are the kind of claim a fact
check (colours, places and counts in the text against the facts) would catch, which stays
the next step if readers find them misleading.

## Consequences

**Made easier.** A second provider means one new adapter file. A second agent reuses the
port and adds its own prompt. The feature still works with no key, in CI and on a fresh
clone. The cost is bounded three times, and the provider's bound is one that cannot bill.

**Made harder.** The route is now slow, can fail partway through, and uses a quota. It
depends on a network service, and the cache is state that disappears on restart. Two
processes each keep their own cache and cap, so the real cap is the per-process cap times
the number of processes. This is fine on the current single instance, and it has to be
revisited when the API scales out, because two processes at 450 would exceed a quota of 500.

**Free has its own costs.** A free tier can be cut or changed by the provider without
notice, and its prompts may be used to improve the provider's models. The prompts here
hold only cube facts, so the second does not matter, and the port means the first costs
one adapter.

**Honest limits.** The gate checks notation, not meaning. A model can still say a pair is
at front left when the facts say back left, and nothing catches that except the prompt and
someone reading the text. A smaller model makes this more likely, not less. Checking
claims (colours and places named in the text against the facts) is possible and is the
next step if the live measurement shows it happens.

## Alternatives considered

**Calling the model from the browser.** Rejected in ADR-0021 step 6: the key would be
public, and the gate would run where it can be bypassed.

**A paid provider (Anthropic, as proposed).** Higher quality and a stable quota, but every
call costs money, which the product owner ruled out. The port keeps it one adapter away.

**A local model through Ollama.** Free and private, and the developer's GPU can run an
8B model quickly. Rejected because it only works while that computer is on: a deployed
API could never reach it, and every explanation would fall back to the template.

**A provider abstraction library** (LangChain, the Vercel AI SDK). It gives many providers
behind one interface, but it is a large dependency for a one-method port, and its
abstractions (chains, tools, memory) are ones this feature does not use.

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
