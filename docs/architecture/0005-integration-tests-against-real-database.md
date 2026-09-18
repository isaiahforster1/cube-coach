# ADR-0005: Integration tests run against a real database

## Status

Accepted — 2026-09-18

## Context

The API's job is almost entirely to read and write a database correctly. Tests have to
decide what stands in for PostgreSQL.

The common approach is to mock the data-access layer: replace the Prisma client with a
fake that returns canned objects. Tests are then fast, need no infrastructure, and run
anywhere.

The problem is what that actually verifies. A mock returns whatever it was told to. It
cannot catch a `WHERE` clause filtering the wrong column, a unique constraint that does
not exist, a cascade that does not fire, a migration that was never applied, or a
timestamp that round-trips in the wrong timezone. Those are the bugs that reach
production, and a mocked test passes cheerfully through every one of them.

## Decision

The API's tests run against a real PostgreSQL instance.

- Locally it is the container from `docker-compose.yml`, on port 5433.
- In CI it is a service container in the workflow.
- A separate database, `cubecoach_test`, is created and migrated automatically by
  `src/test/global-setup.ts` on first run.
- Migrations are applied with `prisma migrate deploy`, the same command CI and
  production use, so the suite exercises the real migration path.
- `reset()` truncates every table between tests, discovering tables from `pg_tables`
  rather than from a hard-coded list.
- Requests go through Fastify's `inject()`, which runs the full stack without opening a
  port.

## Consequences

**Made easier.** Queries, constraints, cascades and migrations are genuinely verified.
Writing a test is also simpler: create real rows, call the endpoint, assert on what the
database contains. There is no mock to keep in sync with reality, which is its own
ongoing maintenance cost.

**Made harder.** Running the tests needs Docker. That is an extra setup step for a new
contributor and an extra service in CI, and it is why the development guide leads with
starting the database.

Test files must run serially, because they share one database. At the current size that
costs a couple of seconds.

The suite is slower than pure unit tests, roughly 2.5 seconds against milliseconds. At
this scale that is irrelevant, and `packages/shared`, where most of the logic lives,
stays pure and instant.

## Alternatives considered

**Mock the Prisma client.** Fast and infrastructure-free, and it verifies almost nothing
about the layer being tested.

**SQLite in memory.** Fast, needs no Docker, and the usual recommendation. Rejected
because it is a different database: different types, different constraint behaviour, no
`timestamptz`, different concurrency. Tests would pass against a database production
does not use, which is precisely the failure this decision exists to avoid.

**Testcontainers.** Starts and stops a container per run programmatically, removing the
"did you start Docker?" step. Rejected for now as one more dependency doing what a
four-line compose file already does. Worth revisiting if managing the container by hand
becomes annoying.

**Transaction rollback per test instead of truncation.** Wrap each test in a transaction
and roll it back. Faster and neatly isolated. Rejected because code that opens its own
transactions then behaves differently than in production, and nested transaction
semantics are exactly the kind of subtle difference that makes a test misleading.
