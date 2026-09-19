# Deployment

One process serves the whole application: the API under `/api/v1`, health probes at
`/health`, and the built web client everywhere else. See
[ADR-0017](architecture/0017-one-origin-in-production.md) for why.

## What has to exist before a first deploy

These are the parts that cannot be created from inside the repository, in the order they
are needed.

| Thing                      | Why                                         | Notes                                                           |
| -------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| A PostgreSQL database      | Solves, sessions and accounts               | Any managed Postgres. Needs a connection string with SSL.       |
| A place to run a container | The one process that serves everything      | Anything that runs a Dockerfile and sets environment variables. |
| A hostname                 | Cookies are `secure`, so it has to be HTTPS | A platform-provided subdomain is fine to start with.            |
| Google OAuth credentials   | Only if Google sign-in should be offered    | Optional. Without them the button does not appear at all.       |

## Environment

Set on the service. Everything is validated at startup, so a missing or malformed value
fails immediately with the name of the variable rather than surfacing on some later
request.

| Variable               | Required | Value                                                                 |
| ---------------------- | -------- | --------------------------------------------------------------------- |
| `NODE_ENV`             | yes      | `production` — switches on secure cookies, HSTS and JSON logs         |
| `DATABASE_URL`         | yes      | The Postgres connection string                                        |
| `PORT`                 | usually  | Whatever the platform expects; defaults to 3000                       |
| `HOST`                 | yes      | `0.0.0.0`, or the container is unreachable from outside itself        |
| `WEB_ORIGIN`           | no       | Only matters if the client is ever served from somewhere else         |
| `WEB_ROOT`             | no       | Defaults to the built client next to the API                          |
| `LOG_LEVEL`            | no       | `info`                                                                |
| `GOOGLE_CLIENT_ID`     | no       | From the Google Cloud OAuth client                                    |
| `GOOGLE_CLIENT_SECRET` | no       | From the same place                                                   |
| `GOOGLE_REDIRECT_URI`  | no       | `https://<host>/api/v1/auth/google/callback`, character for character |

None of these belong in the repository. `.env` is ignored by git and `.env.example` holds
placeholders only.

## Google sign-in

The redirect URI goes in **Authorised redirect URIs**, not Authorised JavaScript origins —
the code exchange happens on the server, so no browser-side origin is involved. It must
match `GOOGLE_REDIRECT_URI` exactly: scheme, host, path, no trailing slash.

Keep the `localhost` URI alongside the production one so development keeps working.

## Database migrations

Run `pnpm --filter @cube-coach/api db:deploy` against the production database as part of
releasing, before the new containers take traffic. `migrate deploy` only applies
migrations that already exist — it never generates one and never prompts, which is what
makes it safe to run automatically.

## Health probes

- `GET /health` — liveness. Touches nothing. A failure means the process is wedged.
- `GET /health/ready` — readiness. Checks the database. A failure means dependencies are
  down and restarting would not help.

Point the platform's restart policy at the first and its traffic routing at the second.
Conflating them causes the classic outage where a brief database blip restarts every
instance.

## Known limitation: scramble quality

Competition-quality scrambles come from a solver that runs in a web worker. In the
production bundle the worker currently fails to instantiate — it works under the
development server and not once built — so the application falls back to move-based
scrambles and labels them **Practice scramble** in the interface.

They are perfectly usable for practice. They are not uniformly distributed, so times are
not strictly comparable with official ones, and the interface says so rather than hiding
it ([ADR-0004](architecture/0004-scramble-generation.md)).

This is a bundling problem rather than a logic one, and it is the last thing worth fixing
before calling the release complete.

## Checklist for a release

1. `pnpm run check` passes.
2. `pnpm --filter @cube-coach/web build` succeeds.
3. Migrations applied to the production database.
4. Container deployed with the environment above.
5. `GET /health/ready` returns `ready`.
6. Open the site: a scramble appears, the timer runs, a solve saves.
7. If Google sign-in is configured, `GET /api/v1/auth/providers` reports `"google": true`.
