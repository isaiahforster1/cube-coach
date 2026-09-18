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

---

## M2 — Scramble generation

### Why not just generate random moves?

Because it is biased. Stringing together random turns does not make every cube position
equally likely — some come up far more often than others — and filtering out redundant
moves does not fix it.

The correct method is **random-state**: generate a uniformly random cube position, then
_solve_ it, and use the solution as the scramble. That is what competitions require, and
it needs a two-phase solver, which is weeks of work.

We use cubing.js, the community-standard implementation, rather than writing one.

> "Random-move scrambles are not uniformly distributed, so competition rules don't accept
> them. Random-state requires a Kociemba solver, which is a solved problem — so I used the
> established library and kept it behind our own interface."

### Why wrap a library in your own interface instead of calling it directly?

Because the dependency then touches exactly one file. If cubing.js is ever too heavy, or
stops being maintained, or we want a fallback offline, the change is confined to one
implementation of `ScrambleProvider` and nothing else in the codebase notices.

This is worth doing when a dependency is _replaceable and consequential_. It is not worth
doing for every library — wrapping something like a date formatter is just extra code.

> "The library sits behind a provider interface, so swapping it touches one file. I only
> do that where the dependency is both replaceable and important enough to matter."

### Why does `Scramble` carry a `quality` field?

Because the two generators are not equivalent, and hiding that would be dishonest to
someone practising seriously. A value of `'random-move'` means "this is a fallback" and the
UI can say so. Silently downgrading quality is the kind of thing that erodes trust in a
tool precisely when it matters.

### Why a dynamic `import()` instead of a normal import?

A normal import is loaded when the file is loaded. A dynamic one is fetched only when the
line actually runs.

cubing.js carries a WebAssembly solver, and the timer should be usable immediately. So the
solver is fetched at the moment a scramble is first requested, not while the page is still
loading. It also keeps the library out of test runs that never touch it.

> "Dynamic import defers loading the WASM solver until a scramble is actually needed, so it
> isn't in the initial bundle."

### Why parse the library's output with our own parser?

Trust boundary. If cubing.js ever emits notation this engine does not implement — a wide
turn, a rotation — parsing throws immediately. Without that check, the cube state would
quietly stop matching the scramble shown on screen, which is close to undebuggable from a
user report.

### Why is the random source injected instead of calling `Math.random`?

So tests can pass in a seeded generator and assert exact output. A test that depends on
real randomness either cannot assert anything specific, or fails one run in fifty — which
is worse than having no test.

Treating randomness as an input rather than a hidden dependency is the same idea as
injecting a clock instead of calling `Date.now()` inside a function. It is one of the most
reliably useful testability patterns there is.

> "Randomness is injected, so tests are deterministic. Same reasoning as injecting a clock
> rather than calling Date.now inside the function you're testing."

### Why test against the real library instead of mocking it?

The only thing worth verifying at that seam is whether _their_ output works with _our_
parser. A mock would return whatever we told it to, proving only that our assumptions agree
with themselves.

General rule: mock things that are slow, flaky, or have side effects you cannot afford.
Do not mock the thing whose real behaviour is the point of the test.

---

## M3 — API skeleton and database

### Why is the app created by a function instead of just existing?

`buildApp()` returns a new Fastify instance, given a config and a database client. The
alternative is a module that creates one app when imported and exports it.

The factory is what makes the API testable. A test builds its own app pointing at the
test database, and nothing has to reach into global state to swap anything out. With a
singleton, every test shares one instance configured from whatever environment variables
happened to be set.

This is dependency injection, without a framework doing it for you: things a component
needs are handed to it rather than fetched by it.

> "buildApp is a factory taking config and a database client, so tests construct their
> own instance against a test database instead of mutating global state."

### What is `app.inject()`?

Fastify can process a request object directly, without a network. `inject()` runs the
entire stack — routing, body parsing, validation, error handling — and returns the
response, with no port opened and no HTTP involved.

So integration tests are nearly as fast as unit tests but genuinely exercise the whole
request path. This is why the API tests take seconds rather than minutes.

### Why validate environment variables at startup?

Because `process.env.DATABASE_URL` is `string | undefined` everywhere, and a typo
surfaces as a confusing failure on whichever request first needed it, possibly hours
into production.

Parsing the whole environment through a Zod schema at boot means a missing variable
crashes immediately with a message naming it, and the rest of the codebase gets a typed
object with no undefined-checking.

> "Fail fast at startup with a clear message, instead of failing later in a confusing
> place. It also gives the rest of the code real types instead of string-or-undefined."

### What is the difference between liveness and readiness?

`/health` asks "is this process running?" and touches nothing external. `/health/ready`
asks "can it serve traffic?" and checks the database.

They mean different things to a deployment platform. A failed liveness check means
restart the process. A failed readiness check means stop sending it traffic but leave it
alone — restarting would not fix a database that is down.

Conflating them causes a classic outage: a brief database blip fails the health check,
the platform restarts every instance, and the restarts make everything worse.

> "Liveness means restart me, readiness means don't route to me yet. Checking the
> database in the liveness probe turns a brief database blip into a restart loop."

### Why one error shape for the whole API?

Every error returns `{ error: { code, message, details? } }`. `code` is a stable
machine-readable string; `message` is for humans and can be reworded any time.

Clients branch on `code`, never on message text. Without that rule, someone eventually
writes `if (error.message === 'Not found')`, and it breaks the day someone improves the
wording.

### Why hide error details in production but not in development?

A stack trace or a raw driver error leaks table names, file paths, library versions, and
sometimes connection strings. That is genuinely useful to an attacker mapping out a
system.

In development you want all of it. The handler branches on `NODE_ENV`, and there is a
test asserting that a connection string does not appear in a production response —
because this is the kind of thing that is easy to regress and invisible when it does.

### Why test against a real database instead of mocking it?

A mock returns whatever you told it to. It cannot catch a `WHERE` clause on the wrong
column, a missing unique constraint, a cascade that does not fire, or a migration that
was never applied. Those are the bugs that reach production.

The API tests run against real PostgreSQL in Docker, on a separate `cubecoach_test`
database that is truncated between tests.

The usual objection is speed. The whole API suite takes about 2.5 seconds, and the pure
logic in `packages/shared` is tested separately in milliseconds. That trade is easy.

> "Mocking the database tests the mock. The bugs worth catching are in the queries and
> constraints, which a mock cannot see. The suite runs against real Postgres in Docker
> and takes about two seconds."

### Why not SQLite in memory for tests?

It is the usual suggestion, and it is a _different database_: different types, different
constraint behaviour, no `timestamptz`, different concurrency. Tests would pass against
something production does not use — precisely the failure mode running a real database
is meant to prevent.

### Why is `migrate deploy` used in tests rather than `migrate dev`?

`dev` generates new migrations from schema changes. `deploy` only applies migrations that
already exist and never generates anything.

`deploy` is what CI and production run, so using it in tests means the suite exercises
the same migration path a real deployment will, rather than a developer-only shortcut.

### Why are penalties stored separately from the solve time?

Because they get corrected after the fact. If a `+2` were added into the stored number,
changing the penalty later would mean subtracting it again, and every toggle is a chance
to drift.

Storing the raw time as immutable and deriving the effective time on read makes the
correction a single field update that cannot corrupt anything.

> "The raw measurement is immutable and the penalty is a separate field, so correcting a
> penalty can't corrupt the underlying time."

### Why integer milliseconds instead of seconds as a decimal?

`14.32` cannot be represented exactly in binary floating point. Times get compared for
personal bests and summed for averages, and floating-point error in either produces
wrong results that are painful to reproduce. Whole milliseconds as an integer are exact.

Same reasoning as storing money in cents.

### Why does the client generate the solve ID?

So that creating a solve is idempotent. If the network drops after the server commits but
before the response arrives, the client retries with the same id and the server
recognises it as the same solve rather than inserting a second one.

For a timer, losing or duplicating a solve is the worst possible failure, and this
removes a whole class of it by construction rather than by careful handling.

### Why not store personal records in their own table?

They would have to be invalidated on every insert, delete _and_ penalty change, and a
stale personal best is both wrong and very confusing.

Computed on read from an indexed query, at realistic volumes, is fast enough. Denormalise
when profiling says to, not in advance.

> "It's a cache, and caches need invalidating. Three different operations can change a
> personal best, so I compute it on read until measurements say otherwise."

---

## M4 — Authentication

### Why sessions in a cookie instead of a JWT?

This is the best answer in the whole project, because almost every candidate reaches for
a JWT without being able to say why.

A JWT is signed and self-contained: the server can validate it without a database lookup.
That statelessness is the entire point, and it matters when many services must validate
independently.

The cost is that **a JWT cannot be revoked**. It is valid until it expires. "Log out"
does not log anyone out — it only deletes the token from the browser that had it. Anyone
who copied it keeps working access.

The usual fix is short access tokens plus refresh tokens, rotation, and a revocation
list. That is server-side state again, with more moving parts and more ways to get it
wrong.

We have one API and one client, so statelessness buys nothing. A random token stored in
the database costs one indexed lookup per request and makes logout actually work. There
is a test that proves it: log out, replay the same token, get 401.

> "JWTs buy statelessness, which matters across many services. I have one API, so it
> bought nothing, and the cost is that you can't revoke them. Opaque session tokens cost
> one indexed lookup and make logout real. I'd revisit it for a mobile client."

### Why is the session token hashed with SHA-256, but the password with Argon2?

Because they are attacked differently.

A **password** is low-entropy — people pick real words. An attacker with the hashes tries
billions of likely candidates, so the hash must be deliberately slow and memory-hungry to
make that expensive.

A **session token** is 256 random bits. There is no dictionary, no likely guess, no
shortcut. Making the hash slow buys nothing and would add a deliberate delay to every
single authenticated request.

Hashing the token at all is still essential, for the same reason as passwords: a leaked
database dump then contains no usable sessions.

> "Slow hashing defends against guessing. A random 256-bit token can't be guessed, so
> slowness buys nothing and costs latency on every request. It's still hashed so a dump
> yields no working sessions."

### What does Argon2id actually do that makes it good?

It is **memory-hard**. A GPU can do billions of simple hashes per second because they are
arithmetic, and GPUs have thousands of tiny cores. Argon2id forces each hash to use 19 MiB
of memory, and a GPU cannot give thousands of parallel threads 19 MiB each. Memory, not
arithmetic, becomes the bottleneck — which is exactly where specialised cracking hardware
loses its advantage.

The parameters are encoded inside the hash string itself, which is why raising the cost
later does not invalidate existing passwords.

### What does `httpOnly` protect against?

JavaScript cannot read an `httpOnly` cookie. So if an attacker gets a script onto your
page — a cross-site scripting bug, a compromised dependency — it still cannot read the
session token.

This is the concrete argument against the common pattern of storing a JWT in
`localStorage`: `localStorage` is readable by any script that runs on the page. The token
is in a cookie precisely so that our own JavaScript cannot touch it.

### What does `sameSite=lax` protect against?

Cross-site request forgery. Without it, a malicious page could submit a form to our API
and the browser would helpfully attach your session cookie, performing an action as you.

`sameSite=lax` tells the browser not to send the cookie on cross-site POST requests, which
breaks that attack without any separate CSRF token. "Lax" rather than "strict" so that
following a link into the app from elsewhere still arrives logged in.

> "SameSite=lax stops the browser attaching the cookie to cross-site POSTs, which is what
> CSRF depends on. Strict would also block normal inbound links."

### Why do an unknown email and a wrong password give the same response?

Because telling them apart turns the login endpoint into a way to discover which email
addresses have accounts.

That matters twice over. It is a privacy leak on its own — this site knows whether a
given person has an account here. And it is the first step of a targeted attack: confirm
the account exists, then concentrate guessing on it.

So both return an identical status, code and message.

There is a subtler version of the same leak: **timing**. If the code returned early when
the user was not found, that response would come back in a millisecond while a real one
took ten, and the difference is measurable. So the service verifies the password against
a throwaway hash even when there is no user, making both paths cost the same.

> "Same status, same code, same message, and the same work done — otherwise the response
> time itself tells you whether the account exists."

### Why is registration allowed to reveal that an email exists?

Because there is no way around it: the user has to be told their email is already
registered, or they cannot proceed.

The mitigation is elsewhere — rate limiting on the endpoint, so it cannot be used to test
thousands of addresses. Worth being able to say out loud, because noticing the asymmetry
is the interesting part.

### Why rate limit the login endpoint specifically?

Two reasons, and the second is the less obvious one.

The obvious one is credential stuffing: someone has a list of leaked passwords and wants
to try them all.

The other is that **our own password hashing is the vulnerability**. Argon2id is
deliberately expensive — that is the point. An attacker who sends a thousand login
requests a second is making the server do a thousand expensive hashes a second, and it
falls over. The defence that protects passwords becomes a denial-of-service vector unless
it is throttled.

> "Argon2 is intentionally slow, so an unthrottled login endpoint lets an attacker
> exhaust CPU just by submitting wrong passwords. Rate limiting protects the server, not
> just the accounts."

### Why is `trustProxy` only enabled in production?

Rate limiting keys on the client's IP. Behind a load balancer the real IP arrives in the
`X-Forwarded-For` header, so Fastify has to be told to trust it.

But that header is just a header — anyone can set it. Trusting it when there is _no_
proxy in front means any client can claim any IP and walk straight around the rate limit.
So it is on in production, where a load balancer sets it, and off everywhere else.

### What is a preHandler, and why is auth opt-in per route?

Fastify runs a `preHandler` before the route body. `requireAuth` looks up the session and
either attaches the user to the request or throws a 401, so handlers never deal with
authentication themselves.

Auth is opt-in — routes declare `preHandler: app.requireAuth` — rather than global with
exceptions. Both are defensible and the failure modes differ: forgetting to opt in leaves
an endpoint public, while forgetting an exception breaks login loudly and immediately.

Opt-in was chosen because the protected routes are listed explicitly and are easy to
audit, and every protected route has a test asserting it rejects anonymous requests. If
the number of routes grows a lot, global-with-exceptions becomes the safer default.

### Why does the API validate the request body when TypeScript already has types?

Because TypeScript does not exist at runtime. Types are erased when the code compiles —
they cannot check what actually arrived over the network. A request body is `unknown` no
matter what the type annotation says.

Zod checks at runtime and _returns_ a typed value, so validation and typing are the same
step. It also strips unknown fields, so a request cannot smuggle in extra properties — a
test posts `isAdmin: true` and confirms it goes nowhere.

The schema lives in `packages/shared`, so the client and the server validate against the
same definition and cannot drift apart.

> "Types are compile-time only, so they can't validate a network payload. Zod validates
> at runtime and infers the type from the same schema, and the schema is shared with the
> client."

### Why is the password minimum a length rule and not "must contain a symbol"?

Length is what actually resists guessing. Composition rules mostly produce `Password1!`,
which is in every cracking dictionary — current NIST guidance recommends against them for
exactly that reason.

There is a maximum too, for a completely different reason: hashing cost grows with input
size, so an unbounded password field is another way to make the server do expensive work.

### Why does login accept any password length while registration enforces a minimum?

Because raising the minimum later would otherwise lock out every existing user. Login
must accept whatever people actually have; the policy applies when a password is _set_.

---

## M5 — Web shell

### Why does every request need `credentials: 'include'`?

Because `fetch` does not send cookies to a different origin unless you tell it to. The
web client runs on port 5173 and the API on port 3000, which are different origins.

Without that one option, the session cookie is silently dropped, every request looks
logged out, and there is no error explaining why — the request succeeds and simply comes
back 401. It is the kind of bug that eats an afternoon, which is why the whole client
goes through one wrapper that sets it once.

> "Cookies aren't sent cross-origin by default. One fetch wrapper sets credentials:
> include so it can't be forgotten at a call site."

### What is CORS actually doing here?

The browser refuses to let one origin read another origin's responses unless that origin
opts in. The API sends headers naming our web origin as allowed.

The detail worth knowing: **the wildcard `*` is forbidden when credentials are
involved.** A cookie is a credential, so the API has to name `http://localhost:5173`
exactly. That is why `WEB_ORIGIN` is a configured environment variable rather than a
convenient star.

> "CORS is the server telling the browser which origins may read its responses. With
> credentials you can't use a wildcard, so the allowed origin is explicit config."

### Why validate on the client when the server already validates?

Speed of feedback, not security.

Client-side validation saves a round trip for an obvious mistake — a malformed email
should not need a network request to be rejected. That is a user-experience win.

It is **not** a security control. Anything sent from a browser can be forged; the request
does not have to come from our form at all. So the server validates independently, always,
and a test posts `isAdmin: true` to confirm the extra field goes nowhere.

The schemas come from `packages/shared`, so both sides check against the same definition
and cannot disagree about what a valid email is.

> "Client validation is for feedback; server validation is for correctness. Same Zod
> schema from the shared package, so they can't drift — but the server never trusts the
> client."

### Why does the protected route have a loading state?

Because on a hard refresh the app does not yet know whether you are signed in — the
session request is still in flight.

If it redirected while the answer was unknown, every authenticated user would be bounced
to the login page on every reload and then bounced back once the session resolved. A
visible flicker, a lost scroll position, and a lost URL.

So it renders a loading state until the answer arrives. There is a test for it: a fetch
that never settles, asserting that neither the login page nor the protected page renders.

### Why is a 401 from `/auth/me` not treated as an error?

Because "nobody is signed in" is a normal answer to "who is signed in?", not a failure.

If it threw, every page would have to distinguish "the request failed" from "you are
logged out". Handling it once, in the session hook, means the rest of the app sees either
a user or `null`.

### Why does the query client retry 5xx but never 4xx?

A 4xx means the server understood the request and rejected it. Sending it again changes
nothing except delaying the error the user needs to see. A 401 will still be a 401.

A 5xx or a dropped connection genuinely might succeed on a second attempt.

Mutations do not retry at all by default, because a mutation changes something and
retrying risks doing it twice.

> "Retrying a 4xx is pointless — the answer won't change. Retrying a mutation risks
> doing it twice."

### Why does logging out clear the whole cache, not just the session?

Because everything else in the cache belongs to the user who just left. Their solves,
their statistics, their personal records are all still sitting in memory, and whoever
signs in next on that machine would see them.

Clearing only the session key would leave a data leak that looks exactly like a rendering
bug.

### What does `htmlFor` on a label actually buy?

It associates the label with the input. Three concrete consequences:

1. Clicking the label focuses the field — a bigger tap target, which matters on a phone.
2. A screen reader announces what the field is when focus lands on it. Without the
   association it announces "edit text, blank" and the user has no idea what to type.
3. `getByLabelText` in tests only finds the input if the association is real — so the
   test passing is itself evidence the accessibility works.

That third point is why the tests query by label rather than by CSS class or test id.

### What do `aria-invalid` and `aria-describedby` do?

`aria-invalid` marks the field as failing validation, so assistive technology says so.
`aria-describedby` points at the error message element, so the error is _read out_ when
focus reaches the field.

Without them, a validation error is red text that a sighted mouse user might notice and
nobody else will. The information is on screen but not in the accessibility tree.

### Why `role="alert"` on the sign-in failure?

It makes a screen reader announce the message the moment it appears, without the user
having to go looking for it.

Otherwise a failed sign-in is completely silent: the button stops spinning, nothing
obvious changes, and the form appears to have done nothing at all.

### Why is the scramble library loaded with a dynamic import?

`cubing.js` carries a 670 KB WebAssembly solver. A static import puts it in the initial
download, delaying the moment the app becomes usable.

The production build confirms it works: the WASM lands in its own chunk, fetched only
when a scramble is first requested. The entry chunk is 117 KB gzipped — React, the
router, the query client, Zod and our own code.

The same build also settled the risk logged in ADR-0004: **`three.js` is not in the
bundle.** `cubing` depends on it for a 3D player we never import, and tree-shaking
removes it. Worth checking rather than assuming, which is why it was written down as a
risk rather than a hope.

### Why does the effect that fetches a scramble have a `cancelled` flag?

Because the component can unmount before the promise resolves, and setting state on an
unmounted component is a bug.

React's StrictMode runs effects twice in development specifically to surface this class
of problem. The cleanup function flips the flag, so a response arriving after unmount is
ignored.

> "The cleanup function marks the effect stale, so a late response doesn't set state on
> an unmounted component. StrictMode double-invokes effects in dev to make that bug show
> up early."

### Why version the API path now rather than later?

Because nothing had hardcoded a path yet. Adding `/api/v1` after a client exists means
changing both sides at the same instant — the coordinated deployment that versioning is
supposed to make unnecessary.

Health checks stay outside the version, at `/health`, because they are infrastructure
rather than API. A load balancer probing the service should not need to know what version
the application is on.

> "Versioning is what lets a breaking change ship as v2 while old clients keep working. I
> added the prefix before any client hardcoded a path, because retrofitting it is the
> coordinated change you're trying to avoid."

---

## M6 — Timer

### Why is the timer a state machine instead of a few booleans?

Because a timer has strict rules about what may follow what, and booleans cannot express
them. With `isRunning`, `isHolding`, `isReady` as separate flags, nothing stops two being
true at once — and that is exactly how a timer ends up able to start while already
running, or to record a solve that never began.

A machine has one `phase` at a time and an explicit list of legal transitions. A
transition that is not written down cannot happen.

> "Six states with explicit transitions, rather than independent booleans that can
> contradict each other. Illegal states become unrepresentable instead of merely
> unlikely."

### Why does the reducer take the time as an argument instead of reading the clock?

Because a function that calls `performance.now()` inside itself can never be tested
without waiting for real time to pass.

Every event carries its timestamp — `{ type: 'pressDown', at: 14302 }` — so the reducer
is a pure function. Thirty tests drive complete solves, including a 17-second inspection
overrun, in microseconds. No fake timers, no `setTimeout` in tests, no flakiness.

This is the same idea as injecting the random source into the scramble generator. Time
and randomness are inputs, not ambient facts.

> "The clock is a parameter, so the reducer is pure. I can test a seventeen-second
> inspection penalty without waiting seventeen seconds, and the test can't be flaky
> because there's no real time involved."

### Why `performance.now()` rather than `Date.now()`?

`Date.now` follows the system clock, which can jump — NTP correcting drift, the user
changing timezone, daylight saving. A solve timed across a backwards jump would record a
negative duration.

`performance.now` is **monotonic**: it only ever moves forward, and it is
higher-resolution. For measuring an interval it is always the right choice.

> "Date.now can jump backwards when the system clock is corrected. performance.now is
> monotonic, so an interval measured with it can't go negative."

### Why is arming the timer a `setTimeout` and the display a `requestAnimationFrame`?

They are different jobs and they fail differently.

`requestAnimationFrame` runs before the next repaint, which makes it right for a number
that changes sixty times a second. But browsers throttle it hard — background tabs,
battery saver, an unfocused window. I measured **two frames in one second** in a
throttled tab.

Originally the hold-to-ready transition was driven by that same loop, so in a throttled
tab the timer could not arm at all. Becoming ready is a state change that must happen
after a fixed duration whether or not anything is being painted, so it got its own
timeout.

The display can freeze harmlessly, because the measured time comes from timestamps taken
at start and stop — not from counting frames.

> "rAF is for painting and gets throttled. A state change on a fixed delay belongs on a
> timeout. The measurement itself is two timestamps, so a frozen display doesn't affect
> accuracy."

### What is `event.repeat` and why does it matter?

Holding a key down makes the browser fire `keydown` repeatedly — the same thing that
types `aaaaaa` when you hold a letter. `event.repeat` is `true` for every firing after
the first.

The timer requires holding space for 550ms before it arms. If each repeat were treated as
a new press, the hold would restart constantly and the timer would never become ready —
it would simply appear broken.

### Why does the spacebar need `preventDefault`?

Space scrolls the page. On a timer that means every start and stop jumps the view.

### Why ignore the key-up that stopped the timer?

Because the same physical press produces `keydown` (which stops the timer) and then
`keyup`. If that `keyup` were treated as "release from ready", the timer would start a
new solve the instant you stopped the last one.

### What happens if the window loses focus mid-hold?

The `keyup` never arrives, so without handling it the timer stays stuck in `holding`
forever, waiting for a release that will never come.

A `blur` listener cancels anything in progress — but deliberately only if the solve has
not yet started. Alt-tabbing during a solve must not throw away the solve.

### Why is a DNF `null` rather than `Infinity` or `-1`?

Because a DNF is not a duration. It is the absence of one.

Encoding it as a number invites it to be averaged, summed or compared by accident, and
the result looks plausible rather than obviously wrong. `null` forces every caller to
decide what a DNF means in their context — which matters enormously in M9, where a DNF
counts as the worst time in an average of five, and two DNFs make the whole average a
DNF.

> "A DNF isn't a number, so I don't store it as one. Infinity or -1 would silently
> survive an average; null makes the caller handle it."

### Why is the displayed time truncated rather than rounded?

Competition convention: 12.999 displays as 12.99, never 13.00.

Rounding up would occasionally show someone a personal best they did not actually
achieve, which is precisely the kind of small dishonesty that destroys trust in a timing
tool.

### Why is the ticking number not inside an `aria-live` region?

Because a live region is announced when it changes, and this one changes sixty times a
second. A screen reader would talk continuously and the app would be unusable.

Instead the number is `aria-hidden`, and a separate visually-hidden region announces the
final result once, when the solve stops. The information reaches the user — just once,
at the moment it is meaningful.

> "Live regions announce on change. A number updating every frame would be a wall of
> speech, so the display is aria-hidden and the result is announced once when it's
> final."

### What bug did using the app find that the tests did not?

After a solve, the timer sat in `stopped` and the spacebar did nothing — starting the
next solve required clicking a button. For someone holding a cube in both hands, that
means putting it down and reaching for the mouse between every single solve.

The unit tests passed, because they encoded the same wrong assumption I had written into
the machine. There was even a test named "does not stop twice" asserting the broken
behaviour was correct.

The lesson is not that the tests were bad. It is that tests verify the behaviour you
specified, and they cannot tell you the specification was wrong. Thirty seconds of
actually using the thing did.

> "Tests check the code against your intent. They can't check your intent. That one
> needed a human pressing the spacebar twice."

---

## M7 — Saving solves

### What does "idempotent" mean, and why does this endpoint need it?

An idempotent operation gives the same result whether you do it once or ten times.
"Set the light to on" is idempotent; "toggle the light" is not.

Creating a solve is normally _not_ idempotent — post it twice, get two rows. That is a
real problem here, because the dangerous failure is the server committing the row and the
response never arriving. The client cannot tell that apart from the server never having
received it. If it retries, it duplicates. If it does not, it loses the solve.

Making the client generate the id removes the dilemma: the server upserts on that id, so
a second request returns the existing row and changes nothing. Retrying becomes always
safe, so the client can retry freely.

> "The client generates the id, so the server can upsert on it. A retry after a dropped
> response returns the existing solve instead of creating a second one — which means the
> client can retry safely, which is what makes the offline queue possible at all."

### Why write the solve to localStorage _before_ sending it, not after it fails?

Because the cases that lose data are the ones where no failure is ever observed: the tab
is closed, the browser crashes, the laptop sleeps mid-request. There is no catch block
for those.

Writing first means the solve is on disk before anything can go wrong, and it is removed
only once the server has confirmed it. Queueing on failure would only handle the failures
polite enough to announce themselves.

> "Queue first, send second. Failures that announce themselves are the easy ones —
> writing on failure misses the tab being closed mid-request."

### Why does the UI distinguish "saved" from "saved on this device only"?

Because a reassuring tick over data that exists in one browser is a lie, and the user only
discovers it when they open another device and find their session missing.

If the solve is queued, the interface says so. Being honest about uncertainty costs a line
of text; being wrong costs trust.

### Why retry a 500 but give up on a 400?

A 4xx means the server understood the request and refused it. A malformed payload will be
refused identically forever, so retrying is an infinite loop that also blocks every solve
queued behind it.

A 5xx or a network failure genuinely might succeed later.

The exceptions worth knowing are 401 (sign in again and the same request works), 408 and
429 (the server is explicitly saying "try later").

### What is keyset pagination, and why not just use OFFSET?

`OFFSET 40 LIMIT 20` says "skip forty rows". Two problems.

**It shifts under the reader.** History is newest-first and new solves arrive constantly.
If three solves are added while someone is reading page two, the rows they already saw get
pushed down — so page three repeats them. Rows can also be skipped entirely.

**It gets slower the deeper you go.** The database cannot jump to row 10,000; it has to
walk past the 9,999 before it.

A keyset cursor names a _position_ instead of a distance: "everything older than this
timestamp". It is stable while rows are inserted, and it uses the index directly, so page
1,000 costs the same as page 1.

> "Offset is a distance, so it shifts when rows are inserted and gets slower as it grows.
> A cursor is a position — stable and index-friendly."

### Why does the cursor include the id as well as the timestamp?

Because two solves can land in the same millisecond, and a cursor of "everything before
12:00:00.000" cannot distinguish between them — one gets skipped or repeated at the page
boundary.

The comparison is really a row comparison: everything strictly older, _plus_ anything at
the same instant with a smaller id. There is a test that records four solves at one
timestamp and pages through them two at a time.

### What is the difference between authentication and authorisation, in this code?

Authentication is "who are you" — the session cookie. Authorisation is "may you touch
this particular row".

Confusing them is one of the most common serious bugs in a web application, and it is
invisible in manual testing because you are only ever signed in as yourself. The failing
shape is an endpoint that checks you are logged in, then acts on whatever id you sent.

So every query here is scoped to the user: `findFirst({ where: { id, userId } })`, never
`findUnique({ where: { id } })` followed by a check. There are four tests that register a
second account and confirm it cannot read, edit, delete or post into the first account's
data.

> "Being logged in isn't permission to touch a specific row. Every lookup is scoped by
> user id in the query itself, rather than fetched and then checked."

### Why return 404 rather than 403 for someone else's solve?

Because 403 confirms the id exists and belongs to somebody. That is a small leak, and it
lets an attacker enumerate valid ids.

404 says only "there is nothing here for you", which is true from that user's point of
view.

### Why can a solve's penalty be edited but not its duration?

Because the duration is a measurement and the penalty is a judgement.

Penalties genuinely get corrected — a cuber marks +2, then realises it was a DNF. The
measurement never changes retrospectively; allowing it to would make the statistics
fiction. `durationMs` simply is not in the update schema, so Zod strips it and the request
fails with nothing left to change. There is a test for that.

### Why does registration create a practice session in the same transaction?

Because a user with no practice session has nowhere to save a solve — the timer would fail
on first use.

A transaction means the account can never exist in that half-configured state: either both
rows are written or neither is. If session creation fails, the registration fails too, and
the user retries rather than ending up with a broken account.

> "Both rows or neither. A user without a session can't save a solve, so that state must
> never exist."

### What did the browser find that the tests did not, this time?

My own test account was created before registration started making a default session, so
it had none. The timer silently skipped saving — no error, no warning, the solve simply
vanished.

That is the exact failure mode ADR-0009 exists to prevent, and I had reintroduced it in
the client by writing `if (practiceSessionId !== undefined)` and not handling the else.

The fix creates a session when an account has none. The general lesson: a guard clause
that silently does nothing is a bug waiting to happen. Either handle the case or fail
loudly.
