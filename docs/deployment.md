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

| Variable                 | Required | Value                                                                   |
| ------------------------ | -------- | ----------------------------------------------------------------------- |
| `NODE_ENV`               | yes      | `production` — switches on secure cookies, HSTS and JSON logs           |
| `DATABASE_URL`           | yes      | The Postgres connection string the application uses                     |
| `MIGRATION_DATABASE_URL` | no       | A more privileged connection for migrations only. See below             |
| `PORT`                   | usually  | Whatever the platform expects; defaults to 3000                         |
| `HOST`                   | yes      | `0.0.0.0`, or the container is unreachable from outside itself          |
| `WEB_ORIGIN`             | no       | Leave unset. See below                                                  |
| `WEB_ROOT`               | no       | Defaults to the built client next to the API                            |
| `LOG_LEVEL`              | no       | `info`                                                                  |
| `GOOGLE_CLIENT_ID`       | no       | From the Google Cloud OAuth client                                      |
| `GOOGLE_CLIENT_SECRET`   | no       | From the same place                                                     |
| `GOOGLE_REDIRECT_URI`    | no       | `https://<host>/api/v1/auth/google/callback`, character for character   |
| `RESEND_API_KEY`         | no       | A Resend API key with sending access only. See below                    |
| `EMAIL_FROM`             | with key | `CubeCoach <verify@mail.<your-domain>>`, on the domain set up in Resend |
| `APP_URL`                | with key | `https://<host>`, the public address links in emails point to           |

### Why `WEB_ORIGIN` should stay unset

It names a _different_ origin allowed to call the API with the visitor's cookie. In
production the API serves the client itself (ADR-0017), so there is no other origin, and
leaving it unset means no CORS headers are sent at all. The browser's same-origin policy
then refuses every cross-origin read, which is exactly right.

Setting it grants that origin credentialed access, so only set it if the client really is
served from somewhere else. Development defaults it to `http://localhost:5173`;
production has no default, because the development one used to apply there too.

None of these belong in the repository. `.env` is ignored by git and `.env.example` holds
placeholders only.

## Google sign-in

The redirect URI goes in **Authorised redirect URIs**, not Authorised JavaScript origins —
the code exchange happens on the server, so no browser-side origin is involved. It must
match `GOOGLE_REDIRECT_URI` exactly: scheme, host, path, no trailing slash.

Keep the development URI, `http://localhost:5173/api/v1/auth/google/callback`, alongside
the production one so development keeps working. It goes through the Vite proxy rather than
straight to port 3000: the callback redirects relatively, to wherever the browser already
is, and that has to be the page the user started on.

## Email verification (Resend)

Optional. Without it, production sends no email, offers no "confirm your email" button,
and every password stays unproved, so a Google link clears it (ADR-0019). With it:

1. **Create a Resend account** at <https://resend.com>. Check the current free-tier limits
   on its pricing page.
2. **Add a sending domain.** Use a subdomain such as `mail.<your-domain>` rather than the
   root, so the records below cannot clash with any mail the root domain already handles,
   and so a reputation problem stays contained to the subdomain.
3. **Add the DNS records Resend shows for that domain**, at your DNS provider, exactly as
   given. Expect:
   - a **TXT** record `resend._domainkey.mail` holding the DKIM public key, which lets
     receivers check the mail really came from Resend on your behalf;
   - an **MX** and a **TXT** (SPF, `v=spf1 include:… ~all`) record on the bounce subdomain
     Resend names (usually `send.mail`), which handle bounces and tell receivers Resend
     may send for you;
   - optionally a **TXT** record `_dmarc.mail` such as `v=DMARC1; p=none;`, which says what
     receivers should do when those checks fail. `p=none` only reports; tighten it once
     mail is flowing.
4. **Wait for Resend to show the domain as verified.** DNS can take minutes to hours.
5. **Create an API key** with **sending access only**, restricted to that domain. Full
   access would let anyone holding the key manage the account.
6. **Set the variables on the Railway service:** `RESEND_API_KEY`, `EMAIL_FROM` (for
   example `CubeCoach <verify@mail.<your-domain>>`) and `APP_URL` (the public
   `https://` address, no trailing slash). Startup refuses a key without `EMAIL_FROM`, and
   in production without `APP_URL`.
7. **Redeploy and check** with step 8 of the checklist below.

`APP_URL` is set rather than taken from requests because the `Host` header is chosen by the
client. Links built from it would let anyone make the application email its users a link
to a site of their choosing.

In development none of this is needed: without a key, the API prints each email, link
included, to its terminal.

## Database migrations

The container migrates on every start, before it serves anything. `apps/api/scripts/start.sh`
runs `prisma migrate deploy` and then starts the server, and nothing needs to be configured
on the platform for it. There is no pre-deploy command; if one was set up for an earlier
version, remove it, because the migrations would simply run twice.

`migrate deploy` only applies migrations that already exist. It never generates one and
never prompts, which is what makes it safe to run unattended. If it fails, the container
exits instead of serving against a schema the code does not understand. The Prisma CLI is
a runtime dependency rather than a development one for exactly this reason.

## A database role that cannot change the schema

Migrations need to create, alter and drop tables. The running application only ever reads
and writes rows. If both use the same role, then any way of making the application run SQL
it did not intend, whether an injection bug or a compromised dependency, can also drop the
tables.

So the two can use different connections:

- `DATABASE_URL` is a role with `SELECT`, `INSERT`, `UPDATE` and `DELETE` only.
- `MIGRATION_DATABASE_URL` is the role that owns the schema, used for `migrate deploy`
  alone. The start script passes it to that one command and removes it from the
  environment before the server starts.

Without `MIGRATION_DATABASE_URL`, migrations use `DATABASE_URL`, which is how a
single-role deployment keeps working.

### Setting it up on Railway

This has to be done by hand, once. Railway's Postgres comes with one superuser,
`postgres`, which owns every table the migrations have created so far.

1. Open the Postgres service's **Data** tab (or connect with `psql` using its public
   connection string) and run the following, choosing a long random password. It creates
   the application role and gives it rows but not schema:

   ```sql
   CREATE ROLE cubecoach_app LOGIN PASSWORD '<a long random password>';

   GRANT CONNECT ON DATABASE railway TO cubecoach_app;
   GRANT USAGE ON SCHEMA public TO cubecoach_app;
   REVOKE CREATE ON SCHEMA public FROM PUBLIC;

   -- Tables and sequences that exist now.
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cubecoach_app;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cubecoach_app;

   -- Tables that future migrations create. Migrations run as postgres, so the
   -- defaults are set for objects postgres creates.
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cubecoach_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
     GRANT USAGE, SELECT ON SEQUENCES TO cubecoach_app;
   ```

   The database is called `railway` unless it was renamed. `PGDATABASE` on the Postgres
   service says for certain.

2. On the application service, add `MIGRATION_DATABASE_URL` as a reference to the
   Postgres service's own URL, `${{Postgres.DATABASE_URL}}`. This is the connection it
   uses today, so nothing changes yet.

3. Change `DATABASE_URL` on the application service to the new role, keeping the host,
   port and database from the Postgres service:

   ```
   postgresql://cubecoach_app:<password>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
   ```

4. Deploy, then check that `GET /health/ready` returns `ready` and that a solve saves.

Doing step 2 before step 3 means there is never a deploy where migrations run as the
restricted role, which would fail.

To confirm the restriction, connect as `cubecoach_app` and run
`CREATE TABLE should_fail (id int);`. It should fail with "permission denied for schema
public".

## Automatic deploys

The platform's GitHub integration deploys on every push to `main`. Turn on its **wait for
CI** setting, so a push that fails `pnpm run check` never reaches production — otherwise
the deploy races the tests and usually wins.

Nothing else is needed: no deploy workflow in this repository, no API token, and no
secret copied anywhere.

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
3. Migrations applied to the production database. The container does this itself on
   start; a failed migration shows up as a container that exits.
4. Container deployed with the environment above.
5. `GET /health/ready` returns `ready`.
6. Open the site: a scramble appears, the timer runs, a solve saves.
7. If Google sign-in is configured, `GET /api/v1/auth/providers` reports `"google": true`.
8. If Resend is configured, it reports `"emailVerification": true`, and registering a
   throwaway account delivers a link that confirms it.
