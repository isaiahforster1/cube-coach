# ADR-0002: Monorepo with a shared source package

## Status

Accepted — 2026-09-18

## Context

Some logic is genuinely needed by both the browser and the server:

- **Cube state and moves** — the client renders and animates the cube; the server validates
  and will later analyse solves.
- **Averaging rules** — ao5 drops the best and worst time, a DNF counts as the worst, and two
  DNFs make the whole average a DNF. The client needs this to show an updated average the
  instant a solve ends; the server needs it to compute authoritative statistics.
- **Request and response shapes** — the client must send what the server expects.

Each of these could be implemented twice, once per side. Averaging is the clearest reason not
to: two implementations of the DNF rules would diverge, and a statistics product that reports
a different ao5 in two places has lost the only thing it sells.

## Decision

A pnpm workspace with three locations:

```
apps/web        React client
apps/api        Fastify server
packages/shared Cube engine, statistics rules, Zod schemas
```

`packages/shared` depends on no framework — no React, no Fastify, no database client. It is
plain functions over plain data.

It is consumed **as TypeScript source**, not as a compiled `dist/`. Its `package.json` points
`exports` directly at `./src/index.ts`, and consumers compile it as part of their own build.

Build orchestration is plain pnpm scripts. Turborepo is deliberately absent.

## Consequences

**Made easier.** One implementation of every shared rule, so divergence is impossible rather
than merely unlikely. No build step in the dependency graph: editing a file in `shared` is
immediately visible to both apps with no watcher and no stale-`dist` class of bug. Type errors
surface across package boundaries with real types rather than generated declarations.

**Made harder.** Consumers must be able to compile TypeScript from `node_modules`, which is
true of Vite and Vitest and will require `tsx` or a bundler for the API. If the package is ever
published externally, it will need a real build step.

**Watch for.** The name "session" means two different things in this domain — a login session
and a practice session. Tables and types are named `auth_sessions` and `practice_sessions`
respectively, never bare `session`, to keep the two from being confused in queries and
conversation.

## Alternatives considered

**No monorepo; duplicate the shared code.** Simplest structurally, and wrong for exactly the
reason above: the averaging rules would drift.

**Four packages (`cube-engine`, `stats`, `contracts`, `tsconfig`).** The original proposal.
Cleaner boundaries in principle, but four `package.json` files and an inter-package dependency
graph is a lot of structure to justify before a single feature exists. One package is one
sentence to explain. It can be split later, when a real seam appears.

**Compile `shared` to `dist/` with TypeScript project references.** The conventional approach,
and necessary for publishing. Rejected for now because it introduces build ordering: every
consumer must wait for `shared` to build, and stale output becomes a category of bug that is
confusing to diagnose.

**Turborepo or Nx from the start.** Their value is task caching, which matters when builds are
slow. With two apps and one package, they would be configuration without benefit. Revisit when
CI time becomes annoying.
