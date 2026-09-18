# Development setup

## Prerequisites

| Tool           | Version     | Notes                                     |
| -------------- | ----------- | ----------------------------------------- |
| Node.js        | 22 or newer | `engine-strict` in `.npmrc` enforces this |
| pnpm           | 12.x        | `npm install -g pnpm`                     |
| Docker Desktop | any current | Needed from M3 onward for PostgreSQL      |
| Git            | any current |                                           |

### Windows notes

Docker Desktop on Windows 11 **Home** requires the WSL2 backend; Hyper-V is not available on
Home editions. If Docker hangs on "Starting" forever, check that WSL is actually installed:

```powershell
wsl --status
```

If it reports that WSL is not installed, run this in an **Administrator** PowerShell and then
reboot:

```powershell
wsl --install --no-distribution
```

The reboot is not optional. A Docker Desktop instance left running from before the install will
also conflict with a fresh one and cause the same hang.

## First run

```bash
pnpm install
pnpm run check
```

`check` runs the same four gates as CI: formatting, linting, type checking and tests. If it
passes locally it should pass in CI.

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

`pnpm -r` runs a script in every workspace package; `--if-present` skips packages that do not
define it, which is why packages without tests do not fail the run.

To work inside one package:

```bash
pnpm --filter @cube-coach/shared test:watch
```

## Repository layout

```
apps/web         React client              (M5)
apps/api         Fastify server            (M3)
packages/shared  Cube engine, stats, Zod schemas
docs/            Documentation and ADRs
```

See [ADR-0002](architecture/0002-monorepo-with-shared-source-package.md) for why the shared
package is consumed as source rather than compiled output.

## Environment variables

There are none yet. When the database arrives in M3, `.env.example` will be committed with
dummy values and `.env` will hold the real ones. `.gitignore` already ignores `.env` and
`.env.*` while allowing `.env.example` through — verify that is still true before adding any
secret to the repository.
