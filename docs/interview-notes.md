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

---

## M8 — History

### What does `useInfiniteQuery` do that a plain query does not?

It keeps a list of pages rather than a single result, and it remembers the cursor for the
next one. Fetching more appends a page instead of replacing the data, so previously
loaded solves stay on screen.

The important discipline: the client never builds a cursor itself. The server returns an
opaque string and the client hands it straight back. That means the pagination strategy —
keyset today, something else tomorrow — can change entirely without touching the client.

> "The cursor is opaque to the client. It sends back whatever the server gave it, so the
> server can change how pagination works without breaking anyone."

### Why a "Load more" button rather than infinite scroll?

Infinite scroll makes the page footer unreachable — content keeps appearing as you
approach the bottom — and it takes control away from anyone navigating by keyboard.

A button is an explicit, focusable control that says what it does. Infinite scroll is
worth it for a feed you browse idly; a solve history is something you search deliberately.

### Why undo instead of a confirmation dialogue?

A confirmation interrupts _every_ delete in order to guard against the rare mistaken one.
Users learn to dismiss it without reading, which means it stops protecting anything while
still costing a click each time.

Undo inverts the trade: the common case (you meant it) costs nothing, and the rare case
is recoverable. It only works because the delete is soft — the row is still there with
`deletedAt` set.

This is also why the restore endpoint was added in this milestone. Without a way back, a
soft delete is just a more complicated hard delete: the extra column buys nothing.

> "Confirmations tax every action to catch the rare mistake, and people click through them
> anyway. Undo costs nothing when you meant it and fixes it when you didn't."

### Why is the newest solve numbered highest?

Because cubers count a session from its first solve: "that was my fortieth today". The
list is newest-first, so the numbering runs the other way — the top row carries the
highest number.

Small thing, and it is the kind of detail that tells a user whether the person who built
the tool actually uses one.

### What went wrong with CORS, and why was it so hard to read?

`PATCH` and `DELETE` failed with `net::ERR_FAILED` — a bare network error with no
explanation — while `GET` and `POST` worked.

The cause: those methods trigger a **preflight**. Before sending the real request, the
browser sends an `OPTIONS` asking "may I send a PATCH here, with these headers?" If the
answer does not explicitly name the method, the real request is never sent.

The preflight itself returned 204, which made it look fine. The failure showed up only on
the request that followed.

The fix was to name the allowed methods explicitly instead of relying on defaults. The
general lesson: when a cross-origin request fails with no useful error, look at the
preflight, not at the request you can see.

> "PATCH and DELETE are preflighted. The OPTIONS response has to name the method or the
> browser blocks the real request — and it surfaces as a generic network error, not a
> CORS message."

### Why did `POST /solves/:id/restore` return 400 when it takes no body?

Because the client was still sending `Content-Type: application/json` with an empty body.
Fastify believed the header, tried to parse nothing as JSON, and rejected the request.

The fix: only set the content type when there is actually a body to describe. A header is
a claim about the payload, and claiming JSON with nothing attached is simply false.

---

## M9 — Statistics and analysis

### How does an average of five actually work?

Drop the fastest and the slowest, mean the middle three. That is the WCA rule, and it
exists so a single lucky or disastrous solve cannot define the result.

The part people get wrong is the DNF. It is not skipped and it is not zero — it ranks as
**worse than any time**. So one DNF in an average of five is trimmed away as the worst
solve and the average still counts. A second one survives the trim, and because it has no
duration the whole average becomes a DNF.

In the code that falls out naturally: DNFs sort last, the same number is trimmed from each
end regardless, and any DNF still standing afterwards makes the result a DNF.

> "Trim the best and worst, mean the rest. A DNF sorts as worse than any time, so one gets
> trimmed and the average survives — two don't, and the average is a DNF."

### Why is a "best average" not just the five fastest solves?

Because it has to be five **consecutive** solves. That is what makes it meaningful: it
measures sustained performance rather than a lucky scatter across a whole session.

The implementation slides a window across the history and keeps the best valid one. There
is a test with fast solves deliberately interleaved with slow ones, asserting the result
is worse than the average of the five fastest — which it must be.

### Why does an average return three cases instead of a number or null?

Because "did not finish" and "not enough solves yet" are different facts and must render
differently: `DNF` versus `—`. Collapsing both into null loses the distinction, and a
sentinel number invites the value into arithmetic where it does not belong.

A discriminated union forces every caller to handle all three. There is a UI test
asserting the screen shows a dash, not `0.00`, for an average that is not possible yet —
a zero reads as an impossibly fast solve.

### Why measure spread as well as average?

Because two cubers with the same average can need opposite advice.

Someone whose solves are all within a second of each other is limited by technique — they
need better methods. Someone alternating between very fast and very slow is limited by
mistakes — they need to stop making them. The average is identical; only the spread tells
them apart.

Deviation is also reported relative to the mean, because two seconds of variation is a
catastrophe at a ten-second average and unremarkable at sixty.

### Why population standard deviation rather than the sample formula?

Dividing by n−1 corrects for the fact that a sample underestimates the spread of the
population it came from. These solves are not a sample — they are the entire history,
every solve there is. There is no wider population being estimated, so the correction
would be adjusting for sampling that never happened.

### How is cross difficulty computed, and why exactly rather than estimated?

A cross is four edges, which is only 190,080 possible arrangements — small enough to solve
completely rather than approximate.

A breadth-first search runs outward from the solved cross once, recording the distance to
every arrangement. Because every move has an inverse, distance is symmetric: the distance
from a scramble to solved equals the distance from solved to that scramble. So one search
answers every future question by lookup — about 90ms to build a table, then 0.01ms per
query.

The alternative was a heuristic like "count how many cross edges are already placed",
which is cheap and unreliable in exactly the cases that matter. The search is fast enough
that approximating would trade correctness for nothing.

> "The cross is four pieces, so the whole state space fits in a table. I BFS out from
> solved once and look up the answer, rather than searching per scramble — the graph is
> undirected, so distances are symmetric."

### Why derive the edge move tables instead of writing them?

Because hand-entered tables were already wrong once, in M1, in a way that passed every
structural test.

Applying each move to a solved cube and observing where the pieces went derives the edge
behaviour from the facelet engine, which is already verified two independent ways. Nothing
new to get wrong, and it inherits the existing confidence rather than needing its own.

### What makes this different from what other timers do?

Every timer records a scramble and a time. Almost none _use_ the scramble — it is an
opaque string to display.

Because the scramble is stored and the engine can solve the cross exactly, we can compare
someone's times on objectively easy scrambles against objectively hard ones. That produces
a statement no other timer can make: _"you average 12.0 when the cross takes five moves or
fewer and 16.5 when it takes more"_ — which is specific, checkable, and leads straight to
a drill.

It also sets the AI work up correctly: the deterministic code finds the pattern, and the
model explains it. An AI given a list of times can only guess confidently.

### Why refuse to show the insight below eight solves per group?

Because with a handful of solves the difference between the groups is noise, and
presenting noise as a finding is worse than saying nothing. A cuber who changes their
practice because of a fluke has been actively harmed by the tool.

The screen says what it is measuring and admits it does not know yet. Being honest about
uncertainty is cheap; being confidently wrong is not.

> "Below a minimum sample I return null and the UI says so. A statistics product that
> reports noise as insight is worse than one that reports nothing."

---

## M10 — Interactive cube

### How do you draw a 3D cube without a 3D library?

Six `div` elements, each rotated to face a different direction and pushed outward from a
shared centre with `translateZ`. The container gets `perspective`, which is what makes
`translateZ` read as depth rather than scale, and rotating the container rotates the whole
assembly.

Each face is a 3×3 CSS grid of coloured squares. That is the entire technique.

> "Six planes, each rotated and translated out from the centre, inside a container with
> perspective. Roughly sixty lines and no dependency."

### What can this approach not do?

Animate a layer turning — and the reason is structural rather than a matter of effort.

The cube is drawn as six **faces**, but a turn moves **pieces**, and the pieces in one
layer belong to five different faces at once. Animating a turn means splitting the model
into 26 individual cubies and re-parenting the nine that are moving, which is the point
where this stops being sixty readable lines and Three.js starts earning its keep.

So: this renders positions, and switching between them is instantaneous. That is enough
for a playground and for showing algorithm cases, and it is not enough for solve replay.

> "Faces are fine for showing a position. A turn moves pieces across five faces at once,
> so animating it needs a piece-based model — that's when I'd bring in Three.js."

### Why does the component take a cube state instead of a scramble?

Because it makes the renderer a **seam**. `CubeView` receives a `CubeState` and draws it;
it knows nothing about moves, scrambles or how the position was reached.

That means swapping CSS for Three.js later touches one file, and nothing else in the
application notices. Introducing that boundary now cost nothing and makes a decision that
was deferred cheap to revisit — which is the whole reason ADR-0001 was comfortable
deferring it.

### Why is colour in the interface rather than the engine?

The engine labels every sticker by the _face_ it belongs to — `U`, `R`, `F` — never by
colour. The mapping to white, red and green lives in one file in the web app.

Two payoffs. The engine stays independent of any particular colour scheme, so a Japanese-
scheme cube or a colour-blind-friendly palette is a one-file change. And the engine's
tests never have to talk about colours, which would be an irrelevant detail in an
assertion about cube mechanics.

### What does `backface-visibility: hidden` do, and why is it needed?

By default a CSS element is visible from behind, so the three faces pointing away from the
viewer show _through_ the three facing it and the cube looks like a wireframe.

Hiding backfaces means each face is drawn only when its front is towards the camera, which
is what makes it read as a solid object.

### Why derive the cube position from the move list instead of storing it?

The playground keeps the list of moves applied as the single source of truth and computes
the position from it on every render.

Undo then becomes "drop the last move", and the displayed position can never disagree with
the history that produced it. Storing both would create two things that must be kept in
step, which is a bug waiting for the first code path that updates one and forgets the
other.

> "The move list is the state; the position is derived. Undo is dropping an element, and
> the two can't drift apart because there's only one of them."

### How do you test something visual in a unit test?

Not by comparing pixels. The test asserts on structure: 54 stickers exist, each face
element contains exactly nine stickers of its own colour when solved, and a scrambled cube
still has nine of each colour overall because moves permute stickers rather than create
them.

The per-face test is the valuable one. It is the check that the CSS transforms agree with
the engine's facelet ordering — an assumption that was easy to make and would have been
easy to get wrong.

Beyond that, the honest answer is that "does it look like a cube?" needs a human or a
screenshot, and no assertion substitutes for it.

---

## Guest mode, Google sign-in and tooltips

### How do you make an account optional without duplicating the whole app?

An interface with two implementations. `SolveStore` describes what storing solves means —
list a page, list all, create, set a penalty, delete, restore — and there are two: one
backed by the API, one by `localStorage`. A single hook picks between them from the
session.

Everything else depends on the interface and never learns which it has. Guest mode is one
branch in one place, rather than an "are we signed in?" check threaded through every
component — which is the version that eventually gets it wrong somewhere.

It was a small change precisely because the features already depended on hooks rather than
calling `fetch` directly. That indirection looked like ceremony when it was written and
paid for itself here.

> "One interface, two implementations, chosen once. Everything downstream is unchanged,
> because nothing downstream ever knew where solves were kept."

### How do guests get statistics without a server?

The same way the server does. `buildStatsSummary` is a pure function in
`packages/shared`, so the browser runs the identical calculation over local solves.

This is the payoff from writing the statistics as pure functions rather than as SQL or as
API logic. A guest and an account holder cannot be shown different numbers for the same
solves, because there is only one implementation of the rules.

### Why not create a throwaway account automatically for each visitor?

It would give every visitor real server-side storage with no form to fill in, which is
genuinely tempting.

But it writes a database row for everyone who passes by, needs a policy for reaping them,
and quietly creates an account for someone who did not ask for one. Keeping guest data in
the guest's browser is honest about what is happening.

### What makes migrating guest solves safe?

Creating a solve is idempotent on a client-generated id. So uploading can be retried
freely — a migration interrupted half way and resumed later cannot produce duplicates.

The local copy is cleared **last**, only after every solve has been accepted. If the
upload fails, the solves stay exactly where they are and the next sign-in tries again. The
failure mode is "tries again later", never "deleted the only copy".

> "The upload is idempotent, so retrying is free, and the local copy is deleted last. The
> worst case is that it happens later, not that anything is lost."

### Why does the interface say "saved on this device" rather than "saved"?

Because a guest's solves exist in exactly one browser. A green tick saying "saved" would
be technically true and practically misleading, and the misunderstanding only surfaces
when they open another device and find nothing there.

Being honest about the limits of a guarantee costs a few words. Being wrong about it costs
trust at the worst possible moment.

### Why is the sign-in link so understated?

Because the product's job is to be a timer, and someone who wants to try a timer should be
able to try a timer. A modal on arrival, a banner, or a counter nagging about registering
all interrupt the thing they came for in order to ask for something they have no reason to
want yet.

The account becomes worth having once there are solves worth keeping. At that point the
link is where you would look for it.

### Why does Google sign-in use the authorization code flow rather than the implicit flow?

The implicit flow returns the access token straight to the browser, where anything running
on the page can read it. The authorization code flow returns a short-lived code, which the
server exchanges for a token using a secret the browser never sees.

The client secret stays on the server, the token never touches the page, and the session
the user ends up with is our own cookie.

> "Implicit hands the token to the browser. The code flow keeps the exchange server-side,
> so the secret and the token never reach the page."

### What is the `state` parameter for?

Cross-site request forgery. Without it, an attacker could send someone a crafted callback
URL carrying the attacker's own authorization code — and the victim would silently end up
signed into the attacker's account, then save their solves there.

A random value goes into a short-lived cookie and into the URL, and the callback refuses
to proceed unless they match.

### Why match Google accounts on the subject rather than the email?

The subject is Google's stable identifier for an account. An email address is not stable —
a workspace administrator can reassign one.

Matching on email alone would mean whoever holds an address today inherits the account of
whoever held it before.

### Then why is linking by email safe at all?

Because Google is asked whether the address is **verified**, and an unverified one is
refused outright.

This is the single check the whole linking design rests on. Without it, anyone who could
create a Google account claiming someone else's address could take over their CubeCoach
account — the classic way this integration is got wrong. There are two tests covering it,
including one asserting that an unverified email cannot be linked to an existing account.

> "Link by email only when Google says it's verified. Otherwise anyone who can create a
> Google account with your address owns your account."

### Why hide the Google button instead of showing it and failing?

An option that fails when pressed looks broken, and the user cannot tell whether the fault
is theirs. The server reports which providers are configured, and the client renders only
those.

### Why is a tooltip a button rather than the `title` attribute?

`title` looks like the easy answer and fails three groups of people: it never appears for
keyboard users, it never appears on touch devices, and screen readers treat it
inconsistently.

A `<button>` is focusable, activates on tap, opens on hover _and_ focus, closes on Escape,
and can be linked to its explanation with `aria-describedby` so assistive technology reads
it as part of the control rather than as stray text.

The first version toggled on click, which meant a mouse user — who has already hovered by
the time the click lands — closed the tip they had just opened. It now opens on click and
dismisses on Escape, on tapping elsewhere, or on the pointer leaving.

---

## Scramble playback and difficulty labels

### Why rewrite the cube from six faces into 26 pieces?

Because a layer turn moves _pieces_, and the nine pieces of a layer own stickers on five
different faces of the engine's array. There is no transform you can apply to a flat face
that does the right thing to a third of it.

Once the cube is 26 small cubes, a turn is one wrapper element around nine of them with a
single rotation on it, and the browser composites it.

The earlier ADR predicted this would need Three.js. It was wrong, and it was wrong because
it measured the difficulty of the _rendering_ rather than the difficulty of the
_coordinates_. Working out where each of the 54 stickers sits in space was the actual
problem; after that the animation was a transform.

> "The renderer had the wrong shape for the job. A turn moves pieces, so I made the cube
> out of pieces."

### How does the animation stay in sync with the engine?

It never computes a position. The player tracks one number — how many moves are done — and
asks the engine for the position. The animation only interpolates an angle.

So while a turn is running, the cube draws _the position before the move with one layer
rotated part-way_. At the full angle that is identical to _the position after the move
with nothing rotated_, because the stickers have landed exactly where the engine says they
go. When the turn finishes, the move count goes up, the rotation is dropped, and nothing
visibly changes.

> "The animation is decoration. The engine is the only thing that knows where stickers
> are, so the picture can never disagree with the model."

This is the same principle as the timer being a pure state machine, and as AI not owning
cube logic: the thing that must be correct is kept separate from the thing that must look
good.

### How do you know the sticker coordinates are right?

The engine's move tables were derived one way — adjacent strips of facelet indices. The
coordinates were derived another — positions in 3D space. If both are right they must
produce identical moves, so there is a test that rebuilds all eighteen moves from the
coordinates alone and compares them against the engine.

It runs over random scrambled positions rather than a solved cube, because on a solved cube
every sticker on a face is the same colour — a mapping that shuffled cells _within_ one
face would pass and still be wrong.

This is the same cross-check that previously caught three reversed tables in the engine
itself.

### What is the subtle bug you had to design a test around?

CSS measures y **downwards**; the cube measures it upwards. So a clockwise turn seen from
outside the cube is a positive CSS rotation for some faces and a negative one for others.

Get it wrong and half the moves spin backwards. There is a test that derives each face's
CSS direction from the cube's own rotation composed with the screen's axis flip, so the
signs are proven rather than guessed.

### What did the browser find that the tests did not?

Pressing "next move" three times quickly only advanced one move: every press during an
animation was being dropped. The button felt broken.

Now an in-flight turn counts as finished the moment another step is requested, so each
press advances a move. There is a test for it that says so.

> "Unit tests told me the state machine was right. Clicking the button told me it felt
> broken. Both are worth doing."

### Why does pausing let the current move finish?

Because stopping a layer at 40 degrees would leave the cube in a position that does not
exist and that the engine cannot describe. Pause stops the _next_ move being queued.

### Why is the cube hidden behind a link rather than shown by default?

Notation is a compressed language. Someone who reads it fluently would find a cube in the
way of the thing they came for; someone who does not read it cannot use the timer at all.

So it is opt-in, the choice is remembered in this browser, and the default stays the
uncluttered screen. The same reasoning as making the account optional — the tool should not
demand something from you before it is useful.

### Why do all the playback controls blur themselves after a click?

Because a focused `<button>` owns the spacebar, and the spacebar starts a solve. Leaving
focus on the play button means the next press replays the scramble instead of starting the
timer — with no visible clue why.

The speed slider blurs on pointer release rather than on change, because blurring on change
would make the arrow keys unusable for someone adjusting it from the keyboard.

### How is a scramble's difficulty measured?

By the optimal cross length, computed exactly by breadth-first search — the same search the
statistics use.

The cross is the only part of a solve the scramble fully determines. Everything afterwards
depends on choices the solver makes; the cross is a fixed, computable cost. So "Hard" is a
precise claim — this cross cannot be done in under seven moves — and the tooltip says so,
including that it measures nothing beyond the cross.

### Where did the thresholds come from?

Measurement, not taste. Over a large sample of random cubes, cross length is ≤4 about 7% of
the time, 5 or 6 about three quarters of the time, and ≥7 about 17%.

So the labels name the tails. A label is only useful if it distinguishes this scramble from
the last one — if every second scramble were "hard" the word would carry no information and
people would correctly stop reading it. A test asserts those shares stay in range, so a
future change to a threshold cannot quietly make the label meaningless.

> "I didn't pick the thresholds, I measured the distribution and named the tails."

### Why compute the rating after the first paint instead of during render?

The first rating builds a search over every reachable cross position — about a tenth of a
second. Every one after that is a table lookup.

A tenth of a second is short and still too long to spend before showing someone their
scramble, so the label appears a moment later and the scramble is readable throughout. A
web worker would remove it from the main thread entirely, which is the right answer if this
grows and more machinery than a one-off tenth of a second deserves now.

---

## Making it feel finished

### Why does one hook drive both the scramble player and the move playground?

Because they disagree about everything except the animation. The player thinks in "how
many moves into this scramble am I"; the playground thinks in "here is the list of moves
someone has pressed". Neither notion belongs in the code that turns a layer.

So `useTurnAnimation` owns only the clock — which move, how far through it is, when it
lands — and hands back a payload the caller supplied. The caller commits it to its own
state. The hook never touches a cube.

> "The shared part was the timeline, not the cube. Once I separated those, both pages got
> the same animation and neither had to learn the other's model."

### Why does starting a turn replace the one already running instead of queueing it?

Because pressing a button four times quickly should move four moves on. Queueing would
make the cube lag further behind every press; refusing — which the first version did —
silently dropped presses and made the button feel broken.

Replacing works because the caller folds the in-flight payload into its own state before
starting the next turn, so the interrupted move is committed rather than lost.

### The collapse animation took three attempts. What was wrong each time?

Worth knowing because each failure looked like success in the DOM.

**First: the grid trick.** CSS cannot interpolate `height` to `auto`, so the fashionable
answer is a single-row grid transitioning from `0fr` to `1fr` — no measuring needed. In
the browser it creates a transition, runs it for the full duration, and animates nothing:
for an auto-height grid there is no free space for the `fr` factor to divide up, so every
positive value resolves the same and only exactly `0fr` collapses. I only caught it by
sampling the computed height over time.

**Second: React and the effect fighting over the same property.** Having measured the
height and set it from a layout effect, I also left `height` in the JSX `style` object.
React reapplies inline styles on every re-render — including the ones this component
triggers itself — so it overwrote the animating value mid-flight. The markup looked
perfectly correct. The fix is that one owner writes a property: the effect owns `height`,
React owns the rest.

**Third: measuring content that had already been removed.** Closing measured the content
to animate away from it, but the children were unmounted in that same commit, because the
"keep them while it closes" flag was state set from an effect — a beat too late. It
measured zero, so it animated from nothing to nothing. Working the closing state out
during the render instead fixed it.

> "Three different bugs, and all three rendered markup that looked right. The only thing
> that found them was sampling the actual computed style over time."

### Why force a reflow instead of using requestAnimationFrame?

Both exist to give the browser a starting value to animate from — two style changes in one
task get collapsed into one, and then there is nothing to transition.

`requestAnimationFrame` is the common answer and it does not run in a hidden or background
tab, so a panel toggled there would be stuck holding its starting height. Reading a layout
property forces the style to be resolved immediately and always works.

The catch is that the line looks like it does nothing, so it is exactly what a tidy-up
deletes. There is a test that fails if it goes.

### Why does the tooltip measure itself instead of using a distance threshold?

Because its height depends on how long the explanation is. A rule like "flip below if the
marker is within 150px of the top" is right for one tip and wrong for the next.

It renders above, measures where it landed, and flips below if it has run off the top. The
measurement happens in a layout effect, which runs before the browser paints, so the flip
is never visible as a jump.

This was a real bug: the scramble's marker sits near the top of the page and the first
line of the tip was cut off by the window edge.

---

## The algorithm library (M11)

### Why is a case stored as a position rather than as an algorithm?

Because it makes the library checkable. Every algorithm site stores a name, a move
sequence and a picture, all typed in by hand, with nothing checking that the three agree.

Here the algorithm is the only stored thing. The position is computed by running it
backwards from a solved cube, and the picture is that position drawn. A mistyped move
produces a wrong picture _and_ a failing test, instead of a quietly wrong lesson.

> "The picture can't disagree with the algorithm, because the picture is the algorithm."

### How do you know the library is complete?

The engine counts the cases. With everything below the top layer solved and the top face
finished, the only freedom left is how four corners and four edges are arranged — and the
two permutations must have matching parity, because every face turn is a four-cycle of
each. That is 288 positions.

Two positions are the same _case_ when a cuber would use the same algorithm on them: when
they differ by adjusting the top layer first, or by holding the cube a quarter turn round.
Collapsing by both gives 22 classes — 21 cases plus the solved cube.

That is the familiar number, and nobody had to look it up. A test asserts the library hits
every one of the 21.

> "I didn't count the rows to check it was complete. I had the engine work out how many
> cases can exist and then checked I'd covered all of them."

### What did that catch?

Two wrong algorithms, neither visible by reading.

One was a duplicate: my Z perm was a perfectly good algorithm that produced a U perm. The
other was worse — my E perm broke the layers below, and my _replacement_ was built on a
wrong belief, that E swaps diagonally opposite corners. The engine put that position in the
same class as the H perm, which turns out to be correct and surprising: a diagonal double
swap with solved edges really is an H perm once you turn the top layer twice. E swaps
adjacent pairs.

That is a fact about the cube I neither remembered nor looked up. It fell out of the
classification.

### So where did the two missing algorithms come from?

A search. Meet in the middle: every position reachable in eight moves from solved, every
position reachable in seven from the target, and the shortest pair that meet. Storing one
half and searching the other turns a fifteen-move problem into two eight-move ones, which
is the difference between minutes and never.

They come out longer than the published algorithms, because the published ones use slice
moves this engine does not have. The interface says which two were found this way.

### What can't you verify?

The names. The engine can prove that a case is a corner three-cycle and that it is distinct
from every other case; it cannot know that cubers call that one `Aa` rather than `Ab`.

Worth saying out loud rather than letting it pass, because it is the one part of the
library resting on memory — and the description beside each case ("three corners cycle,
edges already done") is computed, so a wrong label is at least visible to someone who knows
the case.

### How does the engine read corners when it stores stickers?

The same way it already read edges. Eight slots, each listing its three facelet indices in
clockwise order seen from outside, and a piece is identified by which three faces it shows.

The clockwise ordering is the hand-entered part and the easy thing to get wrong, so it is
checked by an invariant rather than by eye: every move must leave the total corner twist
divisible by three. That holds on a real cube and fails immediately if any corner is listed
the wrong way round.

> "Anything hand-entered gets checked against something the cube itself guarantees."

## Shipping it: the build, the timer and the health check

### Why did the deployed app quietly serve worse scrambles than the dev server?

Because the code that generates a proper scramble runs in a **worker**, and the bundler had
put the entire application in front of it.

A worker is a separate thread with no page in it — no `document`, no DOM. cubing.js boots
its solver in one, and decides at runtime which file to start it from, so the bundler cannot
see that decision. It treated that file as ordinary shared code and hoisted the helpers it
needed into the application's main chunk. The worker's first line therefore imported the
whole app, which touches `document` immediately, and died.

Nothing crashed visibly. There is a fallback that generates a rough scramble by shuffling
moves, so the app kept working and only a small amber notice said which kind you were
getting.

The general lesson: a worker is a **different runtime**, and any bundler decision that
merges its code with page code is a latent crash. It only ever appears in a built bundle,
never with the dev server, which is why it survived to production.

> "The solver runs in a worker, and the bundler had folded the app into the worker's entry
> file. There's no `document` in a worker, so it died on the first line and fell back to the
> weaker scramble."

### There were two fixes. Why did it need both?

Because there were two separate paths for `document` to arrive.

The first was the hoisting above: keeping every cubing.js module in its own chunk stops the
worker's entry sharing a file with our code.

The second was subtler. Vite compiles a dynamic `import()` into `__vitePreload(load, deps)`,
and that helper injects `<link rel="modulepreload">` tags — so it reads `document`. It skips
that work entirely when `deps` is empty, so the fix was to leave the worker's entry with no
dependency chunks at all. Turning module preloading fully off did that; `{ polyfill: false }`
only removed one of the helper's two `document` users.

Checking each change alone was what proved both were needed. Either one on its own still
produced a dead worker.

> "One stopped the app's code reaching the worker; the other stopped Vite's preload helper
> running inside it. I tested them separately, and each alone still crashed."

### Why not just put the whole library in one chunk?

That was the first fix, and it worked. It also threw away cubing.js's own code splitting:
the library ships a chunk per event, and one big chunk meant a 3x3x3 scramble downloaded the
megaminx and side-event solvers as well — about 1.2 MB instead of 800 kB.

Mapping each module to its own chunk name keeps the library's splitting intact and still
separates it from our code.

Worth noting what the measurement showed, because it contradicted the expectation: the main
bundle barely changed either way (447 kB to 445 kB). cubing.js was never in the entry chunk.
The problem was never bundle size; it was **which file the worker booted**.

> "Measuring it showed the entry bundle was the same size either way. The size wasn't the
> bug — the worker's entry file was."

### The timer stuck at red and never went green. What was actually wrong?

Two clocks disagreeing about one boundary.

Releasing starts a solve only after the key has been held for 550ms, and a `setTimeout`
promotes the hold when that time is up. But `setTimeout` truncates a fractional delay to
whole milliseconds, and `performance.now()` is deliberately coarsened for security. So the
callback could arrive when the clock read 549.9ms of a 550ms hold.

The state machine — correctly — declined to arm a hold that is not yet 550ms long. And that
is where it died: nothing changed, so the effect's dependencies did not change, so nothing
ever rescheduled. A single shot had missed, and there was no second one. The timer sat on
`holding` until the key came up.

Intermittent, because it depended on where in a millisecond the press happened to land —
which is exactly why pressing quickly made it show up.

> "The arming timeout fired a fraction of a millisecond early, the machine rightly refused to
> arm, and nothing rescheduled. One missed shot and it was stuck."

### Why fix the scheduler rather than let the machine round up?

Because the machine being strict is the property worth keeping.

A hold of 549.9ms genuinely is not a hold of 550ms. If the reducer starts accepting "close
enough", then the rule it enforces stops being checkable, and every future question about it
— does inspection overrun at exactly 15 seconds? — gets the same fudge.

The imprecision belongs where the imprecision is: in the adapter that reads clocks and
schedules timeouts. So the timeout now re-arms itself, checking the clock and scheduling
again for whatever is left, until the clock itself agrees. It settles in one extra hop at
most, and the measured arming latency did not move — 556 to 563ms before and after.

The general shape: **keep the pure core exact, and put tolerance for the messy world in the
layer that touches the messy world.**

> "I didn't want the state machine to start approximating. The clock imprecision is the
> adapter's problem, so the adapter retries until the clock agrees."

### How did you prove it was fixed, given it only happened sometimes?

Two ways, because neither alone is enough.

A unit test pins the exact mechanism: fire the timeout while the injected clock still reads
549.9ms, and assert the timer arms anyway rather than sitting there five seconds later. It
fails against the old code and passes against the new, which is the only thing that makes it
a regression test rather than decoration.

Then the same scripted burst of presses in a real browser, against a real production build,
before and after: 2 of 15 holds stuck before, 0 of 55 after.

> "A unit test for the exact boundary, and a scripted burst in a real browser before and
> after. The unit test says why; the browser run says whether."

### What can end a touch that cannot end a key press?

Three things, and all three left the timer held.

A browser can **take the gesture away** — deciding a touch was really a scroll, or a pinch,
or a long-press menu. It then sends `pointercancel` and no `pointerup` ever arrives. That one
has to abandon the hold rather than release it, because releasing from an armed hold would
start a solve the person never asked for.

A finger **drifts** over half a second of holding, and a mouse can be dragged off
deliberately. The release then goes to whatever element is under it. Capturing the pointer
redirects everything for that pointer back to the timer surface.

And there can be **more than one**. Two hands on a cube means two thumbs over the screen,
each with its own pointer and its own release. A second thumb lifting was ending the hold the
first was still making, so the surface now remembers which pointer started it.

> "A key press only ends one way. A touch can be cancelled by the browser, wander off the
> element, or be one of several — and all three left it held."

### Capturing the pointer introduced a bug. What happened?

`setPointerCapture` throws if the pointer is no longer active by the time you ask. It was
being called before the press was dispatched, so the throw escaped the handler and the press
was swallowed — the timer did not start at all.

That is a strictly worse failure than the one capture was there to prevent. The press is the
point of the handler; capture is an improvement on the release. So the press goes first, and
the capture is wrapped and allowed to fail.

The habit worth keeping: when you add a nice-to-have to a handler, make sure it cannot take
the must-have down with it.

> "The enhancement threw and killed the thing it was enhancing. Do the essential work first,
> and let the optional part fail quietly."

### Why was `SELECT 1` not a readiness check?

Because it asks the wrong question. It proves something answered on the other end of the
socket — not that the database has any of our tables in it.

A freshly provisioned database with no migrations applied passes `SELECT 1` perfectly. So the
instance reported itself ready, the platform routed traffic to it, and every request that
touched a table failed. That is precisely the situation readiness exists to prevent: the
difference between liveness ("is this process alive?") and readiness ("can it actually
serve?") is that readiness is allowed to know about its dependencies.

It now reads a row from `users` — a `LIMIT 1`, so it stays cheap as the table grows. An empty
table is a fine answer; the question is whether the query can run at all.

> "`SELECT 1` proves Postgres is listening. It doesn't prove the schema was ever created,
> which is the failure that actually happens on a new environment."

### How do you test a readiness check without a broken database?

Make a real one. The test creates an empty Postgres schema, points a client at it, and asks
for readiness — no mocks, because the whole assertion is the difference between "Postgres
answers" and "our tables are there", and a mock would just be restating the answer you
expect.

Two obvious ways to point at that schema do not work, and both are recorded in the test
because both pass against the old route. `?schema=` is a Prisma engine parameter, and Prisma
7 talks to Postgres through the `pg` driver, which ignores it. `?options=-c search_path=`
genuinely changes the session's search path — and changes nothing here, because Prisma writes
fully qualified SQL: `SELECT "public"."users"."id" FROM "public"."users"`. Only telling the
adapter the schema changes what it generates.

The trap is that both wrong versions **pass**, quietly, for the wrong reason. A test that
cannot fail is worse than no test, so the check is always: does this fail against the code I
am replacing?

> "Both of the obvious ways to point at an empty schema silently connected to the real one
> and passed. I only trusted the test once I'd watched it fail against the old route."

### Why does a page scroll on a phone when it fits on the screen?

Because `100vh` is not the height you can see. It is the height of the viewport with the
browser's address bar hidden, which is taller than the visible area while the bar is showing.
A layout that is `min-height: 100vh` is therefore born slightly too long and scrolls a little
no matter what is on it.

`100dvh` — dynamic viewport height — tracks the visible height as the bar comes and goes,
which is what was wanted all along.

The other half of "awkward scrolling" was not scrolling at all: a downward drag near the top
is pull-to-refresh, and a drag past either end is a rubber-band bounce. Both are reasonable
on a document and awful on a timer, where a refresh mid-session reloads the app and the
screen slides under a thumb trying to hold still. `overscroll-behavior-y: none` keeps the
gesture inside the page.

> "`100vh` measures the viewport with the address bar hidden, so the page is always a bit too
> tall. `100dvh` measures what you can actually see."

### The press target was the real complaint. What was wrong with it?

It was a fixed band around the digits — about a quarter of a phone screen — so most of a tap
aimed at "the timer" landed on nothing at all and simply did not register.

Making it claim all the space left over after the scramble and the controls took it from 23%
of the viewport to 56%, which is the target a thumb is actually aiming at. The fix was a
layout change, not an event-handling one: nothing was wrong with the handler, there was just
very little to press.

> "It wasn't missing the presses. There was almost nothing to press — the surface was a
> quarter of the screen and the rest was dead space."

### And the instruction said "press space" on a device with no space bar.

There is no honest way to ask a browser whether a keyboard exists; the platform deliberately
does not expose it. The closest available proxy is the **primary pointer** — `(pointer:
coarse)` is true for a finger and false for a mouse — and it is the proxy the platform
intends for this purpose.

It is subscribed to rather than read once, because the answer changes: a tablet gains a
keyboard case, a laptop folds into a tablet. Reading it at mount would leave the wrong
instruction on screen until a reload.

Worth being clear that it is a proxy and not the real question. A laptop with a touchscreen
reports fine, which is right — it has a keyboard and its owner will use it.

> "You can't ask whether there's a keyboard. You can ask whether the primary pointer is a
> finger, which is the proxy the platform provides for exactly this."

## Whole-cube rotations (solve coaching, part 1)

### Why is a rotation not just another `Move`?

Because `Move` already has a meaning that a great deal of code depends on: one of the 18 face
turns. Tables are keyed by it (`Record<Move, …>` in the cross search and the edge reader),
scrambles are stored as it, and the renderer reads the face to animate from its first letter
with `move[0] as Face`. If `x` joined the union, the tables would have to grow entries they
have no use for. Worse, `faceOf('x')` would still compile and would return `'x'` labelled as a
face.

A separate `Rotation` type, plus `Token = Move | Rotation` for the few places that need
both, means the compiler proves that no scramble, stored algorithm or renderer call can ever
contain a rotation. The type system is doing a job that tests could only sample.

> "Widening the union would have compiled everywhere and been wrong in one place. Keeping it
> separate means the compiler rules rotations out of every path that can't handle them."

### What does the type system _not_ protect?

The states that rotations produce. A rotated `CubeState` is still a `CubeState`, so nothing
stops it being passed to the edge reader or the cross search. Those functions name pieces by
their sticker labels and slots by position, so after a rotation they report facts that are
true but easy to misread. For example, the piece labelled `D` might be sitting correctly on
the face that is now on top.

This is also why `isSolved` stays strict and `isSolvedUpToRotation` judges each face against
its own centre. Once centres can move, the centre is the only reference that means anything.

> "The type keeps rotations out of old code, but not rotated cubes. Anything that asks 'is
> this piece home?' has to ask it relative to the centres."

### How were the rotation tables built, and how do you know they're right?

A quarter rotation is three layer turns done together: `x` is `R`, the middle layer, and
`L'`. The face turns were already verified, so the only new hand-entered data is the middle
layer: four strips of three stickers per axis, 36 numbers in all.

Those numbers are checked in two independent ways. A test rebuilds each rotation by turning
3D sticker coordinates and requires the result to match exactly. Conjugation identities such
as `x U x' = F` require every rotation to relabel every face correctly.

Every test passed first time, so each strip was deliberately reversed to see what caught it.
The geometry test and the conjugation identities did. The structural tests (bijection, 52
stickers moved, four quarter turns return to the start) did not, and neither did counting 24
orientations.

> "A reversed strip is still a perfectly good permutation. It turns the cube the right amount
> and puts some stickers in the wrong place. Only a second derivation, or an identity that
> involves two different faces, can tell."

## The step solver's timing prototype (solve coaching, part 2)

### What is IDA\*, and why use it for an F2L pair instead of breadth-first search?

Breadth-first search finds the shortest answer by visiting everything one move away, then
everything two moves away, and so on. It has to remember every position it has seen, and
with twelve moves available, the number of 9-move sequences runs into the billions.

IDA\* is depth-first search run again and again with a rising move limit: try every
sequence of up to 5 moves, then up to 6, and so on. Depth-first search only has to remember
the current path, so memory stays tiny. The repetition sounds wasteful, but each new limit
costs so much more than the previous one that re-doing the shallower ones barely matters.

What makes it fast is the **lower bound**: a quick lookup that says "at least this many
moves are still needed". Any branch where moves used so far plus the lower bound exceeds the
limit is cut off without being explored.

> "IDA\* is depth-first search with an increasing limit, so it uses almost no memory, and a
> lower bound lets it skip every branch that provably can't finish within the limit."

### Why is the lower bound the larger of two tables, and not their sum?

Each table answers a smaller question exactly: how far the four cross edges are from solved,
and how far this corner and edge are from solved. Solving the whole thing needs at least as
many moves as either part, so the larger of the two is still a guarantee.

Adding them would be wrong, because one move can help both at once. If the bound ever says
more than the true distance, IDA\* skips the branch that holds the real shortest answer and
returns a longer one, with no error.

A bound that never overestimates is called **admissible**. The pair table is built with only
the moves the search is allowed (`U R F L`), which makes its values larger, so it cuts off more,
while staying admissible for this search.

> "Each table is exact for part of the cube, so the larger of them never overestimates. The
> sum could, and an overestimate makes IDA\* quietly return a non-optimal answer."

### Why is the budget a 95th percentile instead of an average?

An average hides the slow cases that people actually notice. In the prototype the median was
under 7 ms, while the slowest solve took 130 ms, about twenty times longer. A mean of 11 ms
describes neither.

The 95th percentile says 19 of every 20 solves finish within the number. The report still
shows the maximum, because a percentile target puts no limit on the worst case, and that is
the number to watch.

> "Search time has a long tail, so I set the budget on p95 and report the maximum next to it.
> A mean would have hidden the solves people complain about."

### Why is there a position cap as well as a depth limit?

They guard against different failures. The depth limit says "an insert longer than 12 moves
is not worth showing". The cap says "never let one request run for seconds". A search could
stay within 12 moves and still visit tens of millions of positions if the lower bound is weak
for that particular position.

Both fail the step loudly, so neither can be mistaken for "no answer exists". The prototype
reached neither limit in 3,000 solves. That is evidence the limits are set sensibly, not
proof, which is why the solver logs every time one is hit.

> "Depth limits the answer, the cap limits the work. Without the cap, one pathological
> scramble can hang a request even though the answer it's looking for is short."

### How does code that only knows the `D` cross handle a cross on another face?

It relabels the cube. Rotate the scrambled cube so the chosen face is on the bottom, then
rename every sticker after the centre it now matches. Centres end up back at their home
labels, so the result is an ordinary position that face turns alone could reach. Every
existing table and reader works on it unchanged.

It is checked independently: for every face, the cross found on the relabelled cube has the
same length as `crossDifficulty` gives for that face on the original scramble.

> "A different cross face is a different view of the same cube, not different code. Relabel
> once at the start, and the D-cross machinery handles all six."

### The timing numbers were fine on the first run. How do you know they measure a working solver?

Only because correctness was checked separately from the search. Every solve is replayed and
judged on the 54 stickers against the centres. That check does not use the search's piece
digits or tables. Then two bugs were introduced on purpose: leaving corners out of the goal
test, and reversing corner twists. Each was caught.

One lesson came out of this. The first time, the broken goal test was caught by the solver's
own "failed" flag, not by the sticker check. The assertions were reordered so the independent
check has to catch it, and it did.

> "A fast wrong answer is worse than a slow right one. I checked every solve on the stickers,
> which don't share code with the search, and broke the search on purpose to prove those
> checks can fail."

### Questions to answer out loud, without notes

- The lower bound ignores the solved pairs the search must put back. Why is it still
  admissible, and what does ignoring them cost? (The prototype measured the answer.)
- Greedy chose the shortest insert every time, and the F2L still totalled 24 moves. Describe
  a position where greedy is clearly worse than the best order.
- The scrambles were random-move, not random-state. What could that do to these numbers, and
  which direction would you expect them to move?
- Opposite faces commute, so the search tries `R L` but never `L R`. Why is that safe, and
  what would break if it also skipped `U` after `R`?
- The cross table takes 90 ms to build and is cached per process. On a server that restarts
  often, when does that start to matter, and what would you do?

## The step solver's cross (solve coaching, part 3)

### Why does `crossDistance` refuse a rotated cube instead of coping with it?

The edge reader names slots by position. On a rotated cube it still finds every piece, but it
reports them in the wrong slots, so the table lookup returns a real-looking number that is
wrong. Nothing would crash. Checking the six centres first costs six comparisons and turns
that silent error into a thrown one.

The split itself is small: `crossDistance(state, face)` does the lookup, and
`crossDifficulty(scramble, face)` became one line that applies the scramble and calls it. A
property test checks the two agree, so the refactor provably changed no behaviour.

> "The reader is only correct when centres are home, so I made that a checked precondition
> rather than a comment. A wrong answer that looks right is the worst kind of bug."

### How does a move the solver found become the move a person is shown?

The solver only ever turns faces, so its cube always has its centres at home. How the person
holds the cube is a `Frame`, worked out by rotating a solved cube and reading which centre
ended up where. Turning the held face `h` turns whichever layer has its centre on `h`. So a
fixed-frame `U'` for a `U` cross, held with `z2`, is shown as `D'`: the `U` centre is now on the
bottom. The turn direction never changes, because a rotation is never a mirror image.

The test for this is the identity in ADR-0021 §5: perform the shown tokens on a real cube,
undo the rotations, and the result must equal the fixed-frame moves applied directly. It runs
over random scrambles, random frames of up to four rotations, and random move lists, and it
compares all 54 stickers.

> "The solver reasons in one frame and speaks in another. The translation is a relabelling
> read off verified tables, and I check it by doing both and comparing the whole cube."

### Why search for the setup rotation instead of writing a six-entry table?

The spike had exactly that table. It was right, but a table is where a typo hides. The
search tries every sequence of up to two rotations (the test proves that reaches all 24
orientations), keeps the ones that put the chosen face on the bottom, and prefers the one that
keeps the front centre in front. That rule is why a `U` cross gets `z2`, not `x2`. The table
would have encoded the same decision without saying why.

> "The rule is written down as code, so the answer can't disagree with the reason."

### How are ties between optimal moves broken, and what is the honest limit?

At each point the solver takes, of all moves that lower the distance by one, the one that is
cheapest as held: `R U F L`, then `D`, then `B`. The cost is measured after translation,
because on an `F` cross, held with `x'`, the fixed `B` face is on top and is performed as
`U`. Order within the cheap group is an
arbitrary fixed choice, only there so the same scramble always gets the same cross.

This is greedy, one move at a time. It is not the cheapest of all optimal crosses: an
expensive first move could open up a cheaper remainder. Finding the true cheapest would need a
search over every optimal path, remembered per position so it does not blow up. That is worth
doing only if the crosses shown turn out to be awkward in practice.

> "Every cross is optimal in length. Ergonomics only breaks ties, and it's greedy. I know
> what the fully correct version would cost and I chose not to pay it yet."

### Why does the oracle check the side stickers, and why only the bottom?

Four bottom-coloured stickers in a plus shape can still be a wrong cross, with two edges
swapped. Each edge's side sticker must also match its side centre.

It judges only the cross on the bottom as held, not "a cross somewhere". That makes it check
the setup rotation too: if the rotation were wrong, the cross would be solved but somewhere
else, and the oracle would reject it. The test adds that the bottom centre is the colour asked
for. The oracle imports nothing from `analysis/` or from the solver.

### The mutation check failed on its first run. Was the solver wrong?

No, the claim was. The first version said "whenever a mutation changes the shown tokens, the
oracle must reject them". Swapping `R` and `L` turns `R L` into `L R`, which is a different
string and the same move, because opposite faces commute. `F' B'` under `x2` instead of `z2`
is the same case. The oracle was right to accept both.

The claim is now about effects. The oracle may accept a mutated answer only if it moves every
piece exactly as the correct answer does (compared after undoing each answer's own rotation,
since `x2` and `z2` leave the cube held differently). Over 600 solves it rejected the inverted
frame 399 times, the `R`/`L` swap 571 times, and `x2` shown with `z2` used 99 times out of the
100 `U` crosses. The inverted frame is never caught on `U` or `D`, and should not be: `z2` is
its own inverse, so that mutation changes nothing there.

A test of the oracle itself was also wrong at first. It rotated a solved cube with `x` and
expected "no cross on the bottom". But a solved cube has all six crosses solved. The fix was
to break the other crosses with `U` first.

> "When a check fails, first ask whether the claim was true. Comparing strings instead of
> effects made a correct result look like a bug."

### Questions to answer out loud, without notes

- `crossDistance` checks centres but not that the state is a legal cube. What input could
  still get a wrong answer out of it, and where should that be caught?
- Give a scramble position where the greedy tie-break produces a more awkward cross than the
  best optimal one. How would memoising cost-to-go per table index fix it, and what does that
  cost?
- The inverted-frame mutation can't be caught on a `U` cross. Is that a gap in the oracle or
  in the mutation? Design a mutation that would be caught on every face.
- Why is it safe for `toHeld` to keep the turn suffix unchanged? What kind of transformation
  would make that wrong?
- The oracle and the solver both use the permutation tables. Given that, in what sense are
  they independent, and what bug could they still share?

## The step solver's F2L (solve coaching, part 4)

### The spike relabelled the cube to make every cross a `D` cross. Why doesn't the solver?

Relabelling rewrites the stickers so another face looks like `D`, then every answer has to be
translated back through that relabelling as well as through the grip. That makes two
translations, and the second one is exactly the kind of silent relabelling ADR-0021 was
written to avoid. The solver instead searches the real scrambled state with the cross face
the `CrossStep` chose. The only things that depend on the face are data: which four slots
exist (`slotsFor`, derived from the corner and edge tables), which cross table bounds the
search, and which two faces the move set leaves out. The code path is the same for all six.

> "The cross face is an input to the data, not a branch in the code. There's one
> translation, from fixed to held, and it's the one the cross already tested."

### How does "choose the `y` for each slot" work without a table?

With the cross on the bottom, the four `y` turns carry any slot round all four sides. For each
candidate (`nothing`, `y`, `y'`, `y2`, in that order) the solver builds the frame and asks
whether the slot's two side colours are now held at front and right. Exactly one works. The
frame then fixes the move set: every fixed face except the ones held at the bottom and the
back. That is how "`U R F L` as held" becomes a different set of fixed faces for each slot.

### Why are there 96 pair tables now instead of 16?

A pair table gives the distance to solve one pair using only the allowed moves. Which moves are
allowed depends on two faces: the cross face (never turned) and the held back (left out so
there's no `B`). Six cross faces × four possible backs × four pairs is 96 tables of 576 bytes.
They are built on demand, 39 ms for all of them. The key is those two excluded faces and the
pair's pieces, which is precisely what the table depends on.

> "Cache on what the result depends on, nothing more and nothing less."

### Why does the pair table use the restricted moves, when the cross table uses all 18?

Both have to be admissible: never more than the real number of moves left. A distance using
all 18 moves can only be shorter than one using a subset, so the cross table is a safe
underestimate for a search restricted to `U R F L`. The pair table built with the restricted
set is also admissible and is tighter, so it prunes more. Either would give the same answers.
The tighter one gives them faster.

### The first version met the budget but was nearly three times slower per position than the spike. Why?

It visited exactly the same positions, so the search was fine. The cost was per position. Two
causes, both in the inner loop:

- `byte()`, the bounds-checked read, is a function call and a branch on every table read.
- The digit tables moved into their own module and were imported. Vitest compiles an imported
  name into a property read on a module object each time it is used. The spike had its tables
  in the same file, so it never paid this.

Copying the tables into local constants and reading them directly took 155 ns per position to
37 ns. The bounds check is still used where it's cheap, when tables are built. In the inner
loop the indices are safe because every digit is below 24, and a test checks the digit tables
against the sticker model for every move.

> "When the work is the same and the time isn't, profile the cost per unit of work before
> touching the algorithm."

### How do you know the tests would catch a broken solver, not just a broken translation?

The mutation check covers translation. Four mutations each got through on none of the 180
solves: the `y` shown but not translated, the `y` translated but not shown, the `y` shown
backwards, and `R` and `L` swapped. The solver itself was broken three ways, one at a time,
and each was caught on all six faces:

- The goal forgets already-solved pairs. The sticker oracle rejects the finished F2L, and the
  "keeps every earlier step intact" property fails.
- The move set allows held `B`. The "no `B` or `D` as held" property fails.
- The chooser takes the longest insert. The re-derived "shortest was chosen" property fails.

### Questions to answer out loud, without notes

- IDA\* re-searches the shallow levels on every iteration. Why is that acceptable here, and
  what fraction of the work is repeated?
- The lower bound is `max(cross, pair)`. Why not `cross + pair`? Give a move that improves
  both at once.
- Greedy pair choice picks the shortest insert now. Sketch a scramble where that makes the
  whole F2L longer, and say what the coaching explanation would lose if the solver looked
  ahead instead.
- An insert that solves its own pair can accidentally solve another one. Where does that pair
  go in the result, and why must it be added to the preserved set straight away?
- The search tracks only the cross edges and the solved pairs. Why is it correct to ignore
  every other piece, and what would go wrong if an unsolved pair's pieces were tracked too?
- The timing test is skipped by default. What stops the solver getting slow without anyone
  noticing, and what would you add to CI to catch it?

## The step solver's facts (solve coaching, part 5)

### Why are held positions words like `'front'` and not letters like `'F'`?

TypeScript compares types by shape, not by name. If a held position were `'U' | 'R' | 'F' | …`
it would be exactly the `Face` type, and a colour could be passed where a place was meant
without any error. The ADR's main risk is an explanation that is true but told in the wrong
grip, so the two had to be types that cannot be swapped. As words, they can't. `held.test.ts`
proves it with `@ts-expect-error` in both directions, and the typecheck fails if either
assignment ever starts compiling. The one place they meet is `NOTATION_LETTER`, because
notation is positional: `R` means "whatever is on the right".

> "If two things must never be confused, make them different types, not just different names."

### Why re-key `Frame` too, when the ADR only asked for it in facts?

Facts are built from the frame. If `Frame.heldPositionOf` still returned a `Face`, every fact
builder would have to convert at the edge, and a missed conversion would compile. Keying the
frame on `HeldPosition` moves the boundary to the one place positions are created. The cost
was mechanical edits in `cross.ts`, `f2l.ts` and their tests, and no behaviour changed. The
same 110 tests passed before and after.

### Which grip is each fact told in, and why not one grip for all?

Each fact uses the grip the person is in at that moment of the step. They choose the pair
before turning the cube, so `pair-choice` uses the grip before the `y`. In that grip the
chosen slot could be anywhere. In the grip after it, the slot is always front right, which
explains nothing. They look for the pieces and perform the moves after the `y`, so
`pair-located`, `preserved` and `also-solved` use that grip. The mutation check builds each
of these in the other grip and confirms the re-derivation disagrees on every step that has a
rotation.

### How are the facts checked without repeating the engine's reasoning?

The engine reads the unrotated state with the piece readers and translates positions through
the frame. The test does neither. It performs the presented tokens on a real cube, rotations
included. It then reads each sticker's facing from the block it is in and its colour from its
label, using sticker groups of its own. The corner groups also need a clockwise order for
twist. That order is anchored at one corner by geometry, and the other seven are proved by
the moves: every face turn is a rigid rotation, so it must carry each listed corner onto
another listed corner in the same cyclic order.

### Why does `pair-joined` count the join that lasts, not the first one?

The fact exists to split a step into "set up and join" and "insert". If a pair were joined,
split and rejoined, the split belongs to the setup, and "first" would count it as part of the
insert. In practice no shortest insert did this: not in 717 steps across 180 solves, and not
in 36,000 random `R U` scrambles searched for one. The likely reason is that a correctly
joined block can always go in whole after a `U` adjustment. A cross-colour-up corner never
counts as joined, because its edge has no cross-colour sticker to match. That is a conjecture
with evidence, not a proof. So the definition that is right either way was kept, and a
hand-built move list (`R R' R U R'` after `R U' R'`) checks the difference.

> "When your data never exercises a branch, build the case by hand. Don't delete the branch."

### How do you know these tests would catch a wrong fact?

Six bugs were planted in the engine, one at a time, and five were caught straight away:
corner twist reversed, cross edges timed by first solve instead of final solve, edge `fit`
mislabelled, cross sides named in the scramble grip, and `also-solved` dropped. The sixth
(first join instead of lasting join) got through, which is what led to the finding above and
the hand-built test that now catches it.

### What is the honest limit of `pair-choice`?

The test proves each claimed insert length is a real insert: performed on the cube, it solves
that pair and keeps everything else. So the chosen insert really is no longer than the
alternatives the engine found. It does not independently prove that no shorter insert
exists for the other slots. That rests on IDA\* with an admissible lower bound, which the
F2L tests cover. Re-proving optimality by brute force would take seconds per step.

### Questions to answer out loud, without notes

- A `HeldPosition` and a `Face` are both strings. Explain structural typing, and name one
  other way to get the same safety, such as a branded type, with its trade-off.
- `pair-choice` is told before the rotation and `pair-located` after it. Walk through
  `L' U L` and say what each fact would claim if the grips were swapped.
- The corner twist is `(cross − vertical) mod 3` over a clockwise sticker order. Why does
  that order survive translation to held positions, and what kind of transformation would
  break it?
- The chirality test would still pass if all eight corners were listed anticlockwise. What
  stops that, and why can't the move check alone catch it?
- `crossFacts` and the test both say "solved for good". Give a cross where an edge is solved,
  knocked out, then solved again, and say what each definition would report.
- Facts add about 0.5 ms per solve. Where does that time go, and when would you compute facts
  lazily instead?

## The step solver's explanations (solve coaching, part 6)

### Why is there a template at all, if a model will write the explanation?

Three reasons, and each one alone would justify it. The feature has to work with no model
configured, so the template is the product in that case, not a stub. A refused model text
needs something to fall back to, or the step would show nothing. And the template is the
reference for what an explanation is allowed to say: it restates facts and nothing else,
so if a model's text says more than the template could, that is a sign it is guessing.

### Why does the template take colour names as a parameter?

The engine labels stickers by face (`'D'`), not by colour, so that the colour scheme lives
only in the interface (`apps/web/src/features/cube/colours.ts`). A cuber with a Japanese
scheme cube, or a colour-blind palette, changes that file and nothing else. If the
template hard-coded "yellow", the engine would have a colour scheme again.

### What exactly does the notation gate check, and what doesn't it check?

It finds every piece of move notation in the text and requires each one to be exactly one
of that step's tokens. It does **not** check numbers ("7 moves"), colours, or claims in
words ("the edge is flipped"). Those rest on the model receiving only the facts, and on the
prompt. The gate is narrow on purpose: notation is the one thing that can be checked
mechanically and exactly, and a wrong move is the most damaging mistake, because the
person will perform it.

### Why does the gate look for moves the engine can't even perform, like `r` and `M`?

Because the gate asks "does this text name a move?", not "does it name a move we know?". A
model that writes `r U r'` has named a move the step does not contain. If the gate only
recognised the 18 face turns and the rotations, it would skip `r` as an ordinary letter and
let the text through.

### Why can uppercase turns run together but lowercase can't?

`RUR'` is a common way to write moves, and almost no English word is spelled in capitals
from only U R F D L B M E S. Lowercase is different: "by" is `b` then `y`, and "fly" is
`f l y`, all valid lowercase turns. Treating lowercase runs as notation would refuse almost
every text. So lowercase counts only as a word on its own.

### Which way does the gate fail, and why is that the right way?

It prefers refusing to missing. `RED` in capitals reads as `R E D` and is refused. The cost
is that the template is shown, which is correct but plainer. Missing a wrong move costs the
person a wrong turn and the product its trust. Two misses are known and documented: a move
inside single quotes (`'R'` reads as `R'`, because the closing quote looks like a prime) and
a possessive (`R's`). They are accepted because the prompt will ask for plain notation, and
fixing them properly means guessing which apostrophes are primes.

> "When a check can only be wrong one way, choose which way, and write down the other."

### How do you know the gate protects against the mistake it exists for?

The mistake ADR-0020 worried about is a move that is true of the cube but wrong for the
person holding it: the solver's fixed-frame move instead of the presented one. The test
offers the fixed-frame moves as if they were a model's text. Of the 554 real steps where
the two differ, 550 are refused. The other four are relabellings where every fixed move
happens to be another move the step also contains, which the gate cannot tell apart and
should not try to.

### How do you know the template itself can't be refused?

Over 120 real solves on all six cross faces, every step's template goes through the same
gate. A planted bug that printed the inverse of the rotation (`y` for `y'`) failed that
test and the worked example.

### Questions to answer out loud, without notes

- The gate passes text that says "this takes 5 moves" when the step takes 7. Why is that not
  the gate's job, and whose job is it?
- `checkNotation` matches tokens exactly, so `R` does not stand for `R'`. Give a sentence a
  good model might write that this refuses, and argue whether refusing it is right.
- Why is it safe for the template to name the rotation, but not safe for it to name a face
  letter as a colour?
- Four fixed-frame steps pass the gate. Construct a two-move example of how a relabelling
  can land on moves the step already contains.
- `chooseExplanation` treats blank model text as "no model". What would go wrong if it
  showed blank text instead, and what would go wrong if it treated it as refused?
- The gate is a denylist of everything notation-shaped not in the tokens. Compare it with
  an allowlist approach, such as asking the model for structured output that references
  tokens by index. What does each cost?

## Committing the solver in pieces (solve coaching, part 7)

### Why five commits and not one, or one per step?

One commit of 4,000 lines cannot be reviewed or bisected. One commit per step would mean
inventing files that never existed, because `solver/cross.ts` imports `crossFacts` from
`solver/facts.ts`, which was written in step 4. A cross-only commit would need a
hand-edited `cross.ts` without facts. That is a version nobody ran, so it is fake history.
The split follows the dependency graph as it is now. Rotations come first because nothing
depends on the solver. Next is the `crossDistance` refactor, which only needs the cube.
Then held positions, the frame and the oracle, which only need rotations. Then cross,
F2L and facts together, because they depend on each other. Last is the template and the
gate, which nothing else imports.

### What does "each commit builds" mean, and how was it checked?

For each commit, a clean checkout typechecks `packages/shared` and `apps/web` and passes the
shared tests. This was run in a separate worktree, so the uncommitted files in the working
copy could not hide a missing file. It matters for `git bisect`. A commit that does not
build can't tell you whether it introduced a bug, so it breaks the search.

### How can one file be split across commits without an interactive `git add -p`?

Write the version of the file you want in this commit, store it as a blob with
`git hash-object -w`, and point the index at it with
`git update-index --cacheinfo 100644,<blob>,<path>`. The working copy is untouched. The
notes, ADR-0021, the ADR index and `solver/index.ts` were split this way, because each
grew section by section.

### Questions to answer out loud, without notes

- `cross.ts` depends on `facts.ts`, and `facts.ts` imports types from `f2l.ts`, which
  imports `cross.ts`. Is that a cycle at runtime, at type level, or both? Why does it
  still work?
- If you wanted cross and facts in separate commits next time, what would you change in
  the code, not the history?
- `solver/try.test.ts` was left uncommitted. What makes a file worth committing even
  though it only prints output?
- Why run the per-commit checks in a separate worktree rather than stashing the rest of
  the working copy?

## Serving the steps (solve coaching, part 8)

### Why does the server run the solver when the browser already has it?

The browser could run the solver and the template: both are pure functions in
`packages/shared`, and the scramble rating already runs there. The part that cannot run
there is the model. Its API key would be visible to anyone who opens dev tools, and the
notation gate has to run where the model's text arrives, before anyone reads it. Putting
the route on the server now, with only the template behind it, means the web app's
contract does not change when the model is added. The cost is a network round trip for
something the browser could compute. That cost is accepted to avoid moving the feature
later.

### Why GET and not POST?

GET means the request is safe (it changes nothing) and idempotent (repeating it gives the
same result). Solving a scramble is both. That allows caching and lets a solution be a
link, which the history page uses. The usual reasons for POST do not apply here. The body
would be a scramble of at most 500 characters, and a scramble is not sensitive, so having
it in a URL or a log is fine.

### Why a separate rate limit for one route?

The global limit is set for cheap requests. This route does 4 to 40 ms of synchronous CPU
work per request, and while it runs the event loop can serve no one else. It needs no
account, so the only thing that limits a script calling it is the rate limit. Once a model
writes the text, every call will also cost money. The limit is a parameter, like
`credentialMax`. That lets the tests raise it out of the way, and one test lowers it to
prove it fires.

### Why does the root export the solver by name?

`export *` from two modules that both export the same name is a compile error in
TypeScript (TS2308), and that error is useful here. `isFirstTwoLayersSolved` exists twice.
The oracle's version compares stickers with the centres, and the `algorithms/` version
compares them with a fixed frame. They have the same name but answer different questions.
Listing the solver's exports makes the public surface a decision. The oracle is a test
tool, so it stays internal.

### What does the URL-as-state pattern buy on the page?

The text field is a draft, and the URL is what is being solved. Submitting writes the URL.
The query reads from the URL, and React Query caches by the normalised scramble and face.
Back, forward, reload and a shared link all work without any code for them, because there
is no second copy of the state that could fall out of sync.

### Questions to answer out loud, without notes

- The route returns `explanation.source` but not the refused notation (`unknown`). Who is
  each field for, and what would go wrong if the client could see the refused text?
- The API test takes its expected tokens from calling `solveCross` and `solveF2L` directly.
  Isn't that testing the code against itself? What does it prove, and what does it leave
  to another suite?
- The route is synchronous CPU work inside an async handler. What happens to other
  requests while it runs? At what point would you move it to a worker thread, and how
  would you know you had reached that point?
- The page validates the scramble with the same schema as the server. Why is the server
  check still needed?
- `staleTime: Infinity` is right for the template today. What changes when a model writes
  the text, and is the answer still "the same question always gets the same answer"?
- The worked-example test expected "The pair already solved stay solved". What kind of
  test locks a bug in place, and what caught it here instead?
- `STANDARD_COLOUR_NAMES` moved from the web app into the shared contract. Argue against
  that move, then say what would have to be true for your argument to win.

#### Drafted answers

Claude wrote these on 2026-09-30 at the developer's request, for the developer to review.
They have not been explained back yet.

1. **`source` and `unknown`.** `source` is for the client: it tells the page who wrote the
   text, and lets a test check it. The page does not show it yet. `unknown` is for the
   developer fixing the prompt, so it goes to the log. The refused text is exactly the
   unchecked model output the gate exists to keep away from readers. Sending it in the
   response, even in a field the page ignores, puts it one line of code from the screen.
   It would also become part of the contract, and clients would start to depend on it.
2. **Testing against itself.** Yes, for the tokens, and on purpose. The test proves the
   route's wiring: it parses the query, applies the scramble to a solved cube, defaults
   to `D`, passes the cross into F2L, and returns every step in order and intact. If the
   route inverted the scramble or dropped a step, the test would fail. It does not prove
   the solver is right, because if the solver is wrong both sides agree. That is the
   shared suite's job, where the sticker oracle checks every step.
3. **Synchronous work in an async handler.** Node runs JavaScript on one thread. The solve
   has no `await` in it, so while it runs (about 4 ms, up to 40 ms, plus about 100 ms the
   first time per face) no other request is handled, not even a health check. They wait
   in the queue. `async` does not help, because it only yields at an `await`. The model
   calls are network waits and do not block. The point to move the solve to a worker
   thread is when solver load makes other routes slow. You would know by measuring:
   `perf_hooks.monitorEventLoopDelay`, or the p99 latency of a cheap route while the
   solver is busy. A worker pool costs a dependency or hand-written pooling, plus copying
   the cube and the answer between threads.
4. **Validating twice.** The page's check is for the user: instant feedback, and no
   wasted request. The server's check is the security boundary. Anyone can call the API
   with `curl`, an old build or an edited page, so the server cannot trust what the
   client claims to have checked. The server's check also protects the CPU (the
   500-character limit). Using one schema in both places means the two cannot drift
   apart.
5. **`staleTime` once a model writes the text.** The answer is no longer always the same.
   The model's wording can differ between calls, after a restart (the cache is in
   memory), between two processes, and after a prompt version change. If the model fails
   or the cap is reached, the same step gets the template instead. The server cache makes
   it usually the same, not always. Part 9, question 6 gives the new reason to keep
   `Infinity`.
6. **A test that locks a bug in place.** The expected string was copied from the code's
   output instead of being worked out from the requirement (correct English). This kind of
   golden-output test checks that the code does what it does, bugs included. A person
   reading the page's real output caught it. The fix also tests the plural, so singular
   and plural each have to be right.
7. **`STANDARD_COLOUR_NAMES` in the contract.** Against: the contract is the wire format.
   English colour words are presentation, which the web app should own, including
   translation and a user's own colour scheme. Putting them in the contract couples server
   and client, so changing a word becomes a contract change. For: the server now writes
   sentences that name colours, so the sentences and the stickers must use one table. The
   argument against wins if the server stops writing colour words. It also wins if names
   have to vary per user or language: then they become data passed in (the template
   already takes `names` as a parameter), and a shared constant is the wrong default.

## Designing the explanation agent (solve coaching, part 9)

The design is in [ADR-0022](architecture/0022-step-explanation-agent.md). These questions
were written while it was Proposed, against a paid Anthropic adapter. It was accepted with
Gemini's free tier instead (part 10). The questions still stand: read "spend" as "quota"
where the free tier changes the meaning. Answers are added here as they are worked out.

### Questions to answer out loud, without notes

- The port is one method: text in, text out. What did leaving out streaming, tools and
  structured output buy, and which future feature would force you to widen it?
- The prompt names colours ("green") instead of passing the facts' `Face` letters. The gate
  would catch a stray `F` anyway. Why prevent it in the prompt as well, and what would the
  refusal rate tell you if you didn't?
- The adapter is given the key explicitly and ignores the SDK's own credential lookup. What
  goes wrong on a developer's laptop if it doesn't? (The Gemini adapter uses `fetch`, which
  has no lookup at all. Which rule in §4 does that make easier to keep?)
- The cache key is a hash of the built prompt, not the scramble. Give a case where two
  different scrambles share an entry. What would have to change for that to be wrong?
- Why are refused and failed replies not cached? What would caching a failure cost, and
  what would not caching a refusal cost if the model refuses the same step every time?
- `staleTime: Infinity` was justified by "the answer never changes". That is no longer
  true, yet it stays. State the new justification, and the one case where it gives the
  reader a worse answer.
- A rate limit of 30 a minute per client does not bound spend. Explain why, and say which of
  the three limits in §5 would stop a thousand addresses each sending 29 requests a minute.
- Two API processes each hold their own cache and daily cap. What are the real cap and
  hit rate then, and what is the smallest change that fixes both?
- The gate checks notation, not meaning. Write a model reply that passes the gate and is
  still wrong, and say how you would catch it without a second model.
- One call per step costs more input tokens than one call per solve. Defend that choice
  to someone who only cares about the bill.

#### Drafted answers

Claude wrote these on 2026-09-30 at the developer's request, for the developer to review.
They have not been explained back yet.

1. **A one-method port.** Every provider can implement text in and text out, and the
   switch from Anthropic to Gemini proved it: one file. The fake is 40 lines. Streaming
   was more than unnecessary here, it was wrong: the gate needs the whole text before
   anyone reads it, so streamed text would reach the reader unchecked. A coaching chat
   would force the port wider: it needs conversation history (a list of messages) and
   probably streaming. The orchestrator agent would need tools. If the gate became an
   allowlist that refers to tokens by index, that would need structured output. Add each
   one as a new optional capability or a second port, and leave `generate` as it is.
2. **Preventing face letters in the prompt as well.** The gate guarantees the letters are
   caught. The prompt makes catching them rare. A refusal is not free: it uses a call of
   the quota and the reader gets the template anyway. In the facts, `F` means green, but
   in notation it means a turn. Given letters, the model would write "the F pair" all the
   time. The refusal rate would then measure that flaw in the prompt, would hide the
   model's real mistakes, and would fail the 5% limit. Measured with colour names, it was
   0%. That number means something only because the prompt does not cause refusals by its
   own design.
3. **The key passed in explicitly.** SDKs look for credentials on their own: an
   environment variable such as `GOOGLE_API_KEY`, or a `gcloud` login. Suppose a
   developer has their personal key exported in their shell for another project. Then
   CubeCoach, and its tests, would call the model on that account, which may be billed,
   even with no key in `.env`. `fetch` reads nothing on its own, so the only key the
   adapter can use is the one config hands it. That makes §4's rule easy to keep: no key
   in our environment means no model.
4. **The prompt as the cache key.** The prompt is built from the step's tokens and facts,
   never the scramble. Take a scramble, and the same scramble followed by an A-perm. The
   A-perm only cycles three top-layer corners and puts every edge back, so the four cross
   edges are in the same places. The cross step's moves and facts match, so both share
   one entry. Their F2L steps differ, because the corners moved. Sharing becomes wrong
   once anything that shapes the reply is missing from the key. That happens if the prompt
   gains the scramble, the user's level or earlier steps without the key changing. The
   realistic way is quieter: the system prompt and `maxTokens` are not hashed. Only
   `EXPLAIN_PROMPT_VERSION` stands for them, so editing the system prompt without bumping
   the version serves old replies.
5. **Not caching refusals and failures.** Failures (timeout, 5xx, 429) pass. Caching one
   would make the cache remember an outage: that step would get the template until the
   entry was evicted or the process restarted, long after the provider recovered. The cost
   of not caching a refusal: a step the model always refuses spends one call each time it
   is asked and still shows the template. A popular step could use up much of the 450.
   The fix would be a short negative cache (skip that key for an hour). Its key includes
   the prompt version, so a prompt fix gets past it. At 0% measured refusals, it is not
   worth adding yet. The log names every refusal, so it would show up.
6. **The new reason for `staleTime: Infinity`.** The text should not change while someone
   is reading it. Fetching again uses quota and gives the reader nothing, because the
   server cache usually returns the same text. The worse case: if the first request fell
   back to the template (timeout, failure or cap), that tab keeps the template for the
   rest of the session, even after the model recovers. The comment in
   `apps/web/src/features/solver/use-solver-steps.ts` gave the old reason ("the answer
   never changes") until it was updated to this one.
7. **A per-client limit does not bound spend.** It limits each address, not their sum: a
   thousand addresses at 29 a minute are each under 30, together 29,000 requests a
   minute, and each new scramble is about five model calls. The global daily cap stops
   it. After 450 calls, every request gets the template until midnight UTC. The provider
   quota is the backstop. The attack still works in two ways. It uses up the model for
   everyone for the rest of the day. And 29,000 solves a minute at about 4 ms each is
   about two minutes of CPU every minute, more than one event loop has. So the route
   itself saturates the event loop, and none of the three limits is designed to stop that.
8. **Two processes.** Each keeps its own count, so the real cap is 2 × 450 = 900, above the
   quota of 500. The provider's 429 becomes the real limit: still no bill, but the app no
   longer falls back by its own rule. Each cache sees only its share of requests. A repeat
   that lands on the other process misses, calls again and may get different wording, so
   the hit rate drops (roughly halved with round-robin). The smallest change that fixes
   both is to move both into the database the API already has. That means a table keyed
   by the same hash, and a counter row for each day that is incremented with one atomic
   `UPDATE … RETURNING`. Dividing the cap by the number of processes fixes the cap only.
9. **Passes the gate, still wrong.** Say the tokens are `y U R U' R'` and the facts say the
   green–red pair starts at back left, with an insert of 4 moves. Then: "The green–orange
   pair is at front left, so y brings it round and U R U' R' inserts it in three moves."
   Every move is in the token list, so it passes. The colour, the place and the count are
   all wrong. To catch it without a second model, check claims the way the gate checks
   notation. Pull out the colour words, place phrases ("front left", "top layer") and
   numbers. Every pair named must be one the facts name, every place must be a place in
   the facts, and every number must be one of the facts' counts. A mismatch refuses and
   falls back to the template. This is the next step the ADR names. Its limit: it checks
   vocabulary, not which number belongs to which claim, or whether "because" is true.
10. **One call per step, for the bill.** On this free tier, tokens cost nothing. The quota
    counts requests, so honestly a call per step costs five times the requests: about 90
    solves a day instead of about 450. The defence: steps repeat across scrambles (part 9,
    question 4) but whole solves almost never do. So the per-step cache saves calls a
    per-solve cache never would. A refusal or failure throws away one step, not all five.
    Calls run in parallel, so the solve's latency is the slowest step's, not the sum. On a
    paid tier, the repeated input is the fixed system prompt, which prompt caching makes
    cheap, and output tokens, which cost more, are the same either way.

## Building the explanation agent (solve coaching, part 10)

[ADR-0022](architecture/0022-step-explanation-agent.md) was accepted with one change from
the proposal. The product owner ruled out paid calls, then ruled out a local model because
it only works while their computer is on. That left a hosted free tier: Gemini
Flash-Lite, with a key from a Google Cloud project that has no billing linked.

### Why did changing provider touch only one file of the design?

The design was written against the port, not the provider. The prompt builder, the gate,
the cache, the cap and the logs all talk to `TextModel`, which takes text and returns text.
The decisions that changed (the adapter, the variables, the cap) are the ones about the
provider. Everything about explaining steps stayed the same. That is the test of a port: a
change of vendor costs an adapter and some configuration, not a redesign.

### Why `fetch` here, when the proposal justified an SDK?

The SDK was justified by typed errors and tested retries for a paid API. Here the adapter
sends one kind of request, the failures that matter are a handful of statuses and reply
shapes, and the retry policy is deliberately narrower than any SDK's default. About 80
lines with their own tests replace a dependency. The reason for a dependency has to be
true for this provider, not the one in the draft.

### What actually stops a bill?

Not the code. The daily cap counts per process and can be wrong. The real limit is that
the key's project has no billing account, so past the quota Google refuses the call with a
429 and cannot charge anything. The cap sits just under that quota so the app falls back
by its own rule, and the quota is the backstop the cap cannot get wrong. The danger is
quiet: linking billing to that project for any other reason moves the key to a paid tier.

### Why is a 429 not retried, when a 503 is?

A retry makes sense when the failure might not happen twice. A 503 is a server having a
bad moment. On a free tier a 429 usually means the quota for the minute or the day is
spent, so asking again fails again and uses more of it. The retry also shares the step's
one deadline, so it can never make the route slower than six seconds.

### Why does the test context pass `null`, when config already says "no key, no model"?

The tests load the developer's `.env`, and that file now holds a real key. If the test
context took the model from config, every API test run would call Gemini and spend the
day's quota. So the default is `null`, and a test that wants a model passes a fake. Only
the opt-in live measurement uses the real key.

### How does a `Map` make an LRU cache?

A `Map` iterates in insertion order. Reading an entry deletes it and sets it again, which
moves it to the end. So the first key is always the least recently used one, and evicting
is deleting `keys().next()`. No linked list or library needed, and every operation is
constant time.

### Questions to answer out loud, without notes

- The cap counts failed calls but not cache hits. Justify both halves.
- Two identical requests arrive at the same moment, before either has filled the cache.
  How many model calls happen? Is that worth fixing, and how would you?
- The model id is pinned (`gemini-3.5-flash-lite`), not `gemini-flash-latest`. What does
  pinning protect, and what does it cost you over a year?
- The adapter drops the original network error instead of keeping it as `cause`. What
  could that error contain, and what do you lose by dropping it?
- A free tier can change its limits or disappear. Walk through what a user sees on the
  solver page the day it does, and what you would change.
- The explainer's tests use a fake model, and the route test uses the same fake. What
  would a bug in the fake hide, and what catches the real adapter's mistakes instead?
- The live measurement calls the adapter directly, not the explainer. Why would measuring
  through the explainer give a misleading refusal rate?

#### Drafted answers

Claude wrote these on 2026-09-30 at the developer's request, for the developer to review.
They have not been explained back yet.

1. **Failed calls count, cache hits don't.** A failed call still reached the provider, and
   the quota counts requests that were made, so the cap has to count them to stay in step
   with it. Not counting failures would also mean unlimited calls during an outage, which
   is exactly when calling again helps least. A cache hit makes no request, so counting it
   would spend the cap on nothing. The lookup also comes before the budget check, so after
   the cap is reached, steps already in the cache still get model text. One gap: the
   budget is taken once per step, but the adapter may retry a 5xx. One unit of the cap can
   then be two requests to the quota. In a long 5xx outage, 450 counted calls could be up
   to 900 requests. The quota still stops it at no charge.
2. **Two identical requests at once.** Both miss the cache, both take from the budget, and
   both call the model. That is ten calls for one five-step solve, possibly with different
   wording, and the last one written wins the cache entry. This is a cache stampede. The
   fix is single-flight: a `Map` from key to the pending promise, so the second caller
   awaits the first call instead of making its own. It is about ten lines. The cost is one
   more case to reason about: both callers share the first call's deadline and its
   failure. It is worth adding if the logs show duplicate calls, for example a
   double-submit, or a shared link opened by many people at once.
3. **A pinned model id.** Pinning keeps the measurement true. The 0% refusal rate, the
   latency and the cap of 450 were all measured on, or chosen for, Flash-Lite and its
   quota of 500. If an alias moved to another model, the wording, the refusal rate and the
   quota could change underneath, unseen. Gemini 3.8 Flash allows 20 a day, so the cap of
   450 would be wrong. The cost over a year: pinned models are deprecated and then shut
   down. On that day every call fails as `rejected` and every step quietly gets the
   template. So someone has to watch for deprecation notices, re-run the live measurement
   on the next model, and change one variable. In the meantime the pinned model misses the
   newer one's improvements.
4. **Dropping the original network error.** A `fetch` error usually holds a `cause` with
   a code (`ENOTFOUND`, `ECONNRESET`, a TLS failure) and the host. The key is in a header,
   not the URL, so it is unlikely to be in there, and the real risk is small. Dropping it
   loses the diagnosis: DNS, a refused connection, TLS, a proxy and a body that was not
   JSON all log the same `unavailable`. A middle ground keeps only safe fields, such as
   `cause.code` and the error's name, and never the object whole. Logging whole error
   objects is the habit that leaks secrets elsewhere.
5. **The free tier changes or disappears.** If the quota is cut, calls past the new limit
   get a 429 and fall back to the template. If the model or tier is removed, calls get a
   4xx (`rejected`) and fall back the same way. The user sees the page work, about as fast
   as before, with the template's plainer wording. There is no error and no bill, because
   no billing is linked. Only a provider that hangs makes it slower, up to the 6-second
   deadline. Nobody would notice except in the logs, which get one `warn` per failed step,
   not one a day like the cap. What would change: lower `EXPLANATION_DAILY_CALL_CAP` to
   the new quota, or change `EXPLANATION_MODEL`, or write one adapter for another
   provider. The gap it exposes: something should alert on the failure rate, and
   possibly a circuit breaker should stop calling for a while after repeated 429s.
6. **The fake.** The explainer's tests prove the explainer works with the fake, so if the
   fake behaves unlike the adapter, they prove the wrong thing. There was a real example.
   The fake's `'hang'` rejected with the signal's `TimeoutError`, while the real adapter
   turns a timeout into `TextModelError('timeout')`. So the tests logged a timeout as
   `failure: 'unexpected'`, but production logs `failure: 'timeout'`. The fallback was
   the same, so nothing broke, but the test was checking a log line production never
   writes. Now the fake rejects with the adapter's error, and the port's comment says
   every adapter must. The adapter's own mistakes are caught by `gemini-text-model.test.ts` with a
   stubbed `fetch`: the request shape, the key in a header, each failure mapped to its
   kind, and the retry rules. They are also caught by the opt-in live measurement against
   the real API. The shared `TextModel` type checks shapes, not behaviour. The way to close
   the gap is one contract test suite run against both the fake and the adapter.
7. **Why the live measurement skips the explainer.** Through the explainer, three things
   would bend the number. The cache would serve repeated steps without a call, counting
   one sample as several passes, while refusals, which are not cached, would be called
   again. The cap could end the run, and every later step would come back as the template
   with the same `no-model` reason as a failure. A timeout or 429 also comes back as that
   template, so failures, the cap and real answers could not be told apart. Calling the
   adapter directly makes every step one real call, and keeps failures (1 timeout) apart
   from refusals (0).

## Checking what the model says (solve coaching, part 11)

[ADR-0023](architecture/0023-explanation-fact-check.md) adds a fact check after the
notation gate. The gate makes sure the model only names the step's own moves. The fact
check makes sure that what it says about colours, places, counts and which moves do which
job agrees with the facts it was given. It is plain code, with no second model, and when
it disagrees the reader gets the template, exactly as when the gate refuses.

### Why not ask a second model whether the first one was right?

Because then you have two unchecked models instead of one. The judge spends the same
free quota and adds its own delay, and it can approve a wrong claim or reject a true one
for reasons no test can pin down. Here the truth is already sitting in the step's facts,
built and re-checked by the engine. Comparing a claim with data you already have is
ordinary code, and CLAUDE.md keeps deterministic work out of the AI.

> "The facts were already computed. Checking a sentence against them is a lookup, not a
> judgement, so it belongs in code that tests can hold to an exact answer."

### How do you test a checker for false alarms, when you can't list every true sentence?

Use a source of text that is true by construction: the template. It only restates facts,
so every claim in it is right. The tests run the template through the check over 120
solves on all six cross faces, about 600 steps, and require it to pass every one. Then
they make one fact wrong in that same text (swap a colour, swap two edges' sides, put a
pair somewhere it never was, give the join one extra move) and require the check to
catch it. One test guards against false alarms, the other against missed errors.

> "The template is a free oracle for true text. Pass it unchanged, fail it with one fact
> mutated."

### Why must a number be next to a noun before it counts as a claim?

Because most numbers in English aren't counts. "This one is shortest" uses "one" as a
pronoun. "Two of the moves are turns of the top" says nothing about how many moves there
are. Reading every number would refuse true text all the time. So a number only counts
when "moves", "edges", "pairs" or similar follows within two words, and the search stops
at "of", "the", punctuation and so on. The cost is honest: "the sixth move" and "a single
move" are not read, so a claim written that way is missed rather than refused.

### Why tune on one live run and report on another?

The rules were adjusted until they read the first corpus correctly: 10 alarms became 3,
and all 3 were real. Reporting 3% from that same corpus would measure how well the rules
were fitted to it, not how well they work. It's the same reason a model is evaluated on a
test set it was never trained on. A second run, on a different seed, gave 7 alarms in 96
replies, all 7 of them really wrong, plus 5 wrong replies that got through. That's the
number that means something.

### Why is "contradicted" a separate reason from "refused"?

They have different causes and different fixes. A notation refusal means the prompt let
the model invent a move. A contradiction means the model misread a fact, or the check
misread the sentence. With one shared reason, every alarm in the log would have to be
opened to tell which. The gate still runs first, so a reply that both invents a move and
gets a fact wrong is reported as the stronger failure.

### Why does the "both join and insert" exemption exist, and what does it cost?

Replies often name the whole sequence and say it "joins the corner and edge and inserts
the pair". That's a summary, and it's true. Checking it like a claim about the first part
of the step would refuse good text. The first version exempted any run said to do both,
and "R U F R F' R join them and insert" got through, with `R` written where the step has
`R'`. The obvious fix, "a run said to do both must be the whole step", was too tight:
"U2 sets them up, then F' U' F joins and inserts them" is true when `F'` makes the pair.
The rule that held up on real replies is "it must run to the end of the step, starting no
later than the joining move". A rule always trades a kind of false alarm for a kind of
miss, and replaying saved replies is what tells you which trade you made before you spend
quota finding out live.

### The fix for a false alarm was found on the measurement run. Why not just report the fixed number?

Seed 2028 was the fresh test set for the second round of rules. It found one true reply
refused, because "with R'" was read with the "join" earlier in the sentence. The fix is
clearly right, and replayed, 2028 then shows only real errors. But that clean number is
fitted: the rule was changed after looking at those replies. So the ADR reports what the
run measured (1 false refusal in 94) and calls the replayed number fitted. After that,
production logs are the ongoing test set, and a fourth seed is only worth spending if the
rules change again.

> "Once you've tuned on a test set, it's a training set. Report the number from before
> the fix."

### Questions to answer out loud, without notes

- The check reads only claims in shapes it knows. Name one true sentence it would wrongly
  refuse, and one false sentence it would let through. Which kind of mistake is worse
  here, and why?
- The gate runs before the fact check. What would go wrong if the order were reversed?
- 7 of 7 alarms were real, but in 4 the logged reason named the wrong claim. Does that
  matter if the fallback was right anyway? Who reads that log, and what do they do with it?
- The model made no colour, place or count mistakes in 196 replies. Should those rules
  stay? Argue both sides.
- `checkFacts` lives in `shared`, not the API. What would you lose by moving it next to
  the prompt?
- Tuning on seed 2026 and reporting on 2027 still leaves one problem if you tune again
  after reading the 2027 replies. What is it, and how would you keep the number honest
  over many rounds?
