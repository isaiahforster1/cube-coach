# Database design

PostgreSQL, accessed through Prisma. The schema lives in
[`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma); this document
explains the decisions behind it.

## Tables

| Table               | Holds                     |
| ------------------- | ------------------------- |
| `users`             | Registered accounts       |
| `auth_sessions`     | Active logins             |
| `practice_sessions` | Named groupings of solves |
| `solves`            | Individual solves         |

The algorithm library (M11) is not here yet: its shape is the least settled, and adding
tables is cheap while changing them is not.

## Decisions worth knowing

### `auth_sessions`, never `sessions`

"Session" means two different things in this product — a login and a practice session.
Naming one of them `sessions` guarantees confusion in queries, types and conversation
for the lifetime of the project. Both are named explicitly.

### Penalties are stored separately from the time

`duration_ms` holds the raw measured time. A `+2` penalty is recorded in the `penalty`
column, not added into the number.

Penalties get corrected after the fact — a cuber marks a solve `+2`, then realises it
was actually a DNF. If the two seconds were baked into the stored time, changing the
penalty would mean subtracting them again, and every toggle is a chance to drift. With
the penalty stored separately, the raw time is immutable and the effective time is
derived on read.

### Integer milliseconds, never floating point

`14.32` cannot be represented exactly in binary floating point. Times are compared for
personal bests and summed for averages, and floating-point error in either produces
wrong results that are very hard to reproduce. Whole milliseconds as an integer are
exact.

### Client-generated solve IDs

`solves.id` has no database default. The client generates a UUID before sending the
request.

This makes creation idempotent: if the network drops after the server commits but
before the response arrives, the client retries with the same id, and the server can
recognise it as the same solve rather than creating a second one. For a timer, losing
or duplicating a solve is the worst possible failure, and this removes a whole class of
it by construction.

### Soft deletes on solves

`deleted_at` rather than an actual delete. Mis-taps on a timer are common, undo should
be possible, and the storage cost is nothing.

### Personal records are not a table

They are computed on read from `solves`.

A stored `personal_records` table would be faster, but it has to be invalidated on
every insert, delete _and_ penalty change — and a stale personal best is both wrong and
very confusing to a user. With an index on `(user_id, solved_at DESC)` and realistic
volumes (a heavy session is a few hundred solves), computing on read is comfortably
fast. Denormalise when profiling says to, not before.

### `puzzle_type` exists although only 3x3 is supported

One enum column now, versus a migration across every table and query later. The enum
has a single value today; adding more is a trivial migration.

### Emails are normalised in the application

Stored lowercase and compared that way, so `A@b.com` and `a@b.com` cannot both
register. PostgreSQL could enforce this with a `citext` column, but that needs an
extension installed in every environment. Normalising in one place in the application
achieves the same thing with no deployment cost.

### Session tokens are stored hashed

`auth_sessions.token_hash`, never the token itself. A leaked database dump then does
not hand an attacker a set of working logins. Same reasoning as password hashing, for
the same reason.

## Indexes

```
solves (user_id, solved_at DESC)
solves (practice_session_id, solved_at DESC)
auth_sessions (user_id)
practice_sessions (user_id)
```

History and statistics both read newest-first within a user or a practice session, and
pagination is keyed on `(solved_at, id)`. Without these indexes every page of history
is a full table scan that gets slower as a user accumulates solves — which is to say,
it gets slower for exactly the users who care most.

## Migrations

Prisma owns the migration history in `apps/api/prisma/migrations/`.

```bash
pnpm --filter @cube-coach/api run db:migrate    # create and apply, in development
pnpm --filter @cube-coach/api run db:deploy     # apply existing, in CI and production
```

`migrate dev` generates a new migration from schema changes. `migrate deploy` only
applies what already exists and never generates anything, which is what CI and
production run. The integration tests use `deploy` as well, so the suite exercises the
same path a deployment will.

Migrations are append-only. Once one has run anywhere other than your own machine,
editing it means the recorded checksum no longer matches and Prisma refuses to
continue. Fix a mistake with a new migration.

## Connecting

Prisma 7 no longer takes the connection URL from `schema.prisma`. The CLI reads it from
`apps/api/prisma.config.ts`; the application passes it to a driver adapter in
`src/db.ts`, which uses the standard `pg` driver rather than Prisma's own query engine
binary. One fewer native binary to ship, and a connection pool that can be configured
directly.
