# Testing

Four gates, run by `pnpm run check` and by CI in the same order: formatting, linting,
type checking, tests. Cheap checks first, so failures surface in seconds not minutes.

## What is tested where

| Layer             | Tool                     | Style                               |
| ----------------- | ------------------------ | ----------------------------------- |
| `packages/shared` | Vitest + fast-check      | Pure unit and property tests, no IO |
| `apps/api`        | Vitest + real PostgreSQL | Integration through `app.inject()`  |
| `apps/web` (M5)   | Vitest + Testing Library | Component behaviour                 |
| End to end (M12)  | Playwright               | A handful of critical paths         |

The weight is deliberately at the bottom. The cube engine and the statistics rules are
where correctness actually matters, and they are pure functions, which are the cheapest
possible thing to test exhaustively.

## Property-based testing

For the cube engine, a rule that holds for every input beats a list of examples:

> any sequence of moves, followed by its inverse, returns to a solved cube

fast-check generates hundreds of random sequences trying to break it, and shrinks any
failure down to the smallest case that still fails.

The limit is worth understanding. A property exercising one operation in isolation can
pass on an implementation that is wrong but self-consistent. "Four quarter turns returns
to solved" holds for any set of 4-cycles, correct or not. Three of the six move tables
were wrong and passed every structural test. What caught them was asserting known
identities that depend on two different faces interacting. See ADR-0003.

## The API is tested against a real database

Not a mock. ADR-0005 has the full reasoning; briefly, a mocked database only proves our
assumptions agree with themselves, while the bugs worth catching live in the queries,
constraints, cascades and migrations.

Requests go through Fastify's `inject()`, which runs the whole stack including routing,
body parsing, validation and error handling, without opening a port. That keeps
integration tests nearly as fast as unit tests.

### How it works

`apps/api/src/test/global-setup.ts` runs once per suite. It creates `cubecoach_test` if
it does not exist and applies migrations with `prisma migrate deploy`.

`apps/api/src/test/context.ts` builds an application wired to that database and exposes
`reset()`, which truncates every table. Tables are discovered from `pg_tables` rather
than hard-coded, so a new table cannot be forgotten and leak rows between tests.

Test files run serially, because they share one database and parallel truncation would
let one file wipe the fixtures of another mid-test. If the suite ever gets slow enough
to matter, the fix is a database per worker, not parallel writes to one.

### Running them

```bash
docker compose up -d
pnpm --filter @cube-coach/api test
```

The test database is created and migrated automatically on first run. It is separate
from the development database, so running the suite never destroys data you were working
with by hand.

## What is deliberately not mocked

Two examples, because the instinct is usually to mock both.

**The database.** Mocking it would test the mock. The interesting failures, such as a
wrong `WHERE` clause, a missing cascade, or a constraint that does not fire, are
invisible to a mock by definition.

**cubing.js.** The only thing worth verifying at that seam is whether their output works
with our parser. A mock returns whatever we tell it to, proving nothing.

The general rule: mock what is slow, flaky, or has side effects you cannot afford, such
as payment providers, email, or third-party APIs. Do not mock the thing whose real
behaviour is the point of the test.

## Randomness and time

Both are injected rather than read from the environment inside a function.

The scramble generator takes a `random()` function, so tests seed it and assert exact
output. A test depending on real randomness either cannot assert anything specific or
fails one run in fifty, which is worse than no test.

The timer in M6 will take a clock the same way, for the same reason.

## Coverage

High where it matters, which is the cube engine and the statistics rules, and pragmatic
elsewhere. A repository-wide coverage percentage is a number people learn to game, and
it says nothing about whether the risky parts are covered.
