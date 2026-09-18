# Development setup

## Prerequisites

| Tool           | Version     | Notes                                     |
| -------------- | ----------- | ----------------------------------------- |
| Node.js        | 22 or newer | `engine-strict` in `.npmrc` enforces this |
| pnpm           | 12.x        | `npm install -g pnpm`                     |
| Docker Desktop | any current | Required from M3 onward, for PostgreSQL   |
| Git            | any current |                                           |

### Windows notes

Docker Desktop on Windows 11 **Home** requires the WSL2 backend, because Hyper-V is not
available on Home editions. If Docker hangs on "Starting" forever, check whether WSL is
actually installed:

```powershell
wsl --status
```

If it reports that WSL is not installed, run this in an **Administrator** PowerShell and
then reboot:

```powershell
wsl --install --no-distribution
```

The reboot is not optional. A Docker Desktop instance left running from before the
install will also conflict with a fresh one and produce the same hang.

## First run

```bash
pnpm install
docker compose up -d
pnpm --filter @cube-coach/api run db:generate
cp apps/api/.env.example apps/api/.env
pnpm --filter @cube-coach/api run db:migrate
pnpm run check
```

`check` runs the same four gates as CI: formatting, linting, type checking and tests. If
it passes locally it should pass in CI.

## The database

PostgreSQL runs in Docker, from `docker-compose.yml` at the repository root. It listens
on **5433**, not the default 5432, so it cannot collide with a Postgres installed
directly on your machine.

```bash
docker compose up -d      # start
docker compose ps         # check health
docker compose logs -f postgres
docker compose down       # stop, keeping data
docker compose down -v    # stop and delete all data
```

There are two databases. `cubecoach` is for development, and `cubecoach_test` is created
automatically the first time the API tests run. The tests only ever touch the second, so
running them never destroys data you were working with by hand.

See [database.md](database.md) for the schema and the reasoning behind it.

### Migrations

```bash
pnpm --filter @cube-coach/api run db:migrate   # create and apply, in development
pnpm --filter @cube-coach/api run db:deploy    # apply existing, in CI and production
pnpm --filter @cube-coach/api run db:studio    # browse the data in a GUI
```

After editing `schema.prisma`, run `db:migrate` to generate a migration and regenerate
the typed client. Nothing in the API typechecks until the client has been generated.

## Scripts

Run from the repository root.

| Script                  | Purpose                           |
| ----------------------- | --------------------------------- |
| `pnpm run check`        | Everything CI runs, in CI's order |
| `pnpm run format`       | Rewrite files with Prettier       |
| `pnpm run format:check` | Fail if anything is unformatted   |
| `pnpm run lint`         | ESLint across the workspace       |
| `pnpm run lint:fix`     | ESLint with autofix               |
| `pnpm run typecheck`    | `tsc --noEmit` in every package   |
| `pnpm run test`         | Vitest in every package           |

`pnpm -r` runs a script in every workspace package, and `--if-present` skips packages
that do not define it.

To work inside one package:

```bash
pnpm --filter @cube-coach/shared test:watch
pnpm --filter @cube-coach/api dev
```

## Repository layout

```
apps/web         React client              (M5)
apps/api         Fastify server
packages/shared  Cube engine, scrambles, statistics, Zod schemas
docs/            Documentation and ADRs
```

See [ADR-0002](architecture/0002-monorepo-with-shared-source-package.md) for why the
shared package is consumed as source rather than as compiled output.

## Environment variables

`apps/api/.env`, copied from `apps/api/.env.example`. `.env` and `.env.*` are gitignored
with an exception for `.env.example`, so real values cannot be committed by accident.

| Variable            | Purpose                               |
| ------------------- | ------------------------------------- |
| `DATABASE_URL`      | Development database connection       |
| `TEST_DATABASE_URL` | Test database, wiped between tests    |
| `NODE_ENV`          | `development`, `test` or `production` |
| `PORT` / `HOST`     | Where the API listens                 |
| `LOG_LEVEL`         | pino log level                        |

They are validated at startup by `apps/api/src/config.ts`. A missing or malformed
variable fails immediately, naming the variable, rather than surfacing later as a
confusing error on whichever request first needed it.
