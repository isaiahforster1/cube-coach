# ADR-0018: Rules for authorisation, identity and cost

## Status

Accepted — 2026-09-26

Amends [ADR-0013](0013-google-sign-in.md): linking by email is no longer justified by
Google's verification check alone.

## Context

A security review found ten problems. Most were small, and all are fixed, but they were not
ten unrelated accidents. Read together, they follow a handful of patterns:

- **An id was trusted on its own.** Creating a solve upserts on the client-generated id,
  and the lookup inside the upsert was by id alone, so posting another user's solve id
  returned their solve. Every other endpoint scoped by user; this one did not, because a
  write does not look like a read.
- **Input reached the database unchecked.** Bodies and queries were validated, but `:id`
  path parameters were not, and a malformed one surfaced as a 500.
- **An unproved credential survived an identity link.** Registration never verifies email.
  An attacker could register someone else's address, and when the real owner later signed
  in with Google, they were linked into the attacker's account with the attacker's
  password and session still working. The `email_verified` check proved the Google side of
  the link and nothing about the other side. Separately, an address already linked to one
  Google account could be re-linked to another.
- **Cost grew with data the user controls.** Statistics loaded every solve and ran the cube
  engine on every scramble, blocking the event loop for seconds and eventually overflowing
  the stack.
- **Trust was implicit.** The proxy setting trusted every hop of `X-Forwarded-For`; a
  development default for the web origin applied in production; the runtime database role
  could alter the schema.

Fixing each instance was necessary but not enough. Unless the rules are written down, the
next endpoint repeats the pattern. This project is also about to add AI agents that read
user data and act on it, which is the easiest place to break every one of these rules
at once.

## Decision

These are rules for all code in the API. A change that breaks one needs an ADR explaining
why.

### 1. An id never grants access on its own

Every id in a request is looked up together with the caller's `userId`, in the same query.
Anything that finds, updates, deletes or _returns_ a row by id is scoped to its owner.

This includes idempotent writes. An upsert or "insert or return existing" keyed on a
client-supplied id checks the owner of whatever it found before returning it, and refuses
with a conflict otherwise. An idempotency key identifies a request, not a permission.

A row belonging to someone else is reported as not found (404), never forbidden, so the
response does not confirm that it exists. The one exception is a conflict on a
client-generated id, where the caller already holds the id.

### 2. Every body, param and query is parsed with zod

At the edge, before the handler uses it. Handlers take their types from the parse, not from
route generics like `Params: { id: string }`, which assert a type without checking it. Ids
are validated as UUIDs.

### 3. An identity is linked only to credentials that have been proved

Linking a new sign-in method to an existing account is only safe when both sides have been
proved to belong to the same person. Where one side has not, the proved side wins and the
unproved one is discarded:

- Google sign-in linking by email to an account with an unverified password clears the
  password and revokes every existing session, in the same transaction.
- An account already linked to a Google subject is never re-linked to a different subject
  because the email matches. Subject is identity; email is contact information.

If email verification at registration is ever added, a verified password becomes a proved
credential and may survive a link. Until then, it may not.

### 4. Anything whose cost grows with stored data has a per-account bound

The size of a user's history is under the user's control, so every operation over it needs
a bound that is not:

- Writes that grow the data have a **per-account** rate limit, keyed on the user id after
  authentication, set for human speed. Bulk workloads such as guest migration get their
  own endpoint and budget rather than a looser limit on the human one.
- Expensive per-item analysis runs over a bounded recent window (the cross analysis uses
  the last 1000 solves).
- No `Math.min(...array)` or other spread over stored data. Arguments live on the call
  stack.

The per-IP global limit stays on top of these, but is not relied on alone: an attacker
controls how many IPs they use, not how many accounts they are signed in as.

### 5. Trust in infrastructure is explicit

- The proxy trust setting states its **hop count**, as a function. `true` trusts the
  client's own claim, and in Fastify 5 a bare number trusts nothing. If a proxy is added,
  the count changes with it.
- Development defaults do not apply in production. Where production needs a value, it is
  either derived safely (redirects are relative) or has no default.
- The application's database role has no DDL rights. Migrations use a separate connection
  that the running server never receives.

### 6. AI agents follow the same rules, and a few more

The coaching agents planned for this project read a user's solves and respond in natural
language. A language model will follow instructions that appear in its input, so:

- **User text is untrusted data.** Solve comments, session names and chat messages are
  passed to a model as data, clearly delimited, and never as instructions. Nothing a user
  writes can change an agent's tools, scope or system prompt.
- **Context is built only from per-user scoped queries**, the same repository functions the
  API uses, with the caller's `userId`. An agent never runs a query that is not scoped to
  the user it is serving.
- **Tools are read-only and scoped to the caller.** A tool takes no user id as an argument;
  the id comes from the authenticated session. A tool that needs to write goes through the
  same service functions and rules as an HTTP request would.
- **The API key stays on the server**, and model spend has a **per-user budget**, which is
  rule 4 again: model calls are the most expensive operation the application will have.
- **No cross-user data goes into prompts or logs.** Aggregate or comparative features ("how
  do you compare with others?") use precomputed, anonymised figures, never another user's
  rows. Prompts and completions are logged no more fully than requests are.

## Consequences

**Made easier.** Reviewing a new endpoint becomes a checklist: is every id scoped, is every
input parsed, does its cost grow with data, is anything trusted implicitly? The agent rules
exist before the agents do, which is much cheaper than retrofitting them.

**Made harder.** A user who registered with a password and later signs in with Google loses
the password. That is the intended trade until registration verifies email, but it will
surprise someone. Some generic helpers, such as "find by id", are deliberately unavailable
without a user id, which costs a parameter everywhere.

The per-account limits and the analysis window are numbers chosen by judgement (60 solves a
minute, 10 batches a minute, 1000 solves). They should be revisited if real use pushes
against them, not quietly raised.

**What is still open.** Registration does not verify email. Statistics still load a user's
whole history into memory; a cached summary updated on write is the next step if histories
reach hundreds of thousands of solves.

## Alternatives considered

**Fixing the instances without writing rules.** Quicker, and the bugs would stay fixed. The
patterns would not: the upsert leak happened because one endpoint did not look like the
others, and the next one will not either.

**Row-level security in Postgres.** Enforcing ownership in the database, with the user id
set per connection, is stronger than application checks, because a forgotten `WHERE` is
caught by the database. It needs a transaction per request to set the user safely through a
connection pool, and a way to run migrations and tests around it. Worth revisiting when the
AI agents arrive, since they are the most likely place for an unscoped query to appear.

**Email verification at registration instead of discarding the password.** The better
long-term fix for pre-hijacking, and it would let a verified password survive a link. It
needs outbound email, which the project does not have yet. Discarding unproved credentials
is correct now and remains correct after verification exists.
