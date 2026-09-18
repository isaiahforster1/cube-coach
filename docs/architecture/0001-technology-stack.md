# ADR-0001: Technology stack for the MVP

## Status

Accepted — 2026-09-18

## Context

CubeCoach is a full-stack Rubik's Cube training platform. The MVP covers authentication,
a timer, scramble generation, solve history, practice sessions, statistics, personal
records, an interactive cube, and an algorithm library. AI features are explicitly out of
scope until the foundation is solid.

Two constraints shaped this decision as much as the requirements did:

1. The developer is using the project to learn full-stack engineering and must be able to
   explain every choice under interview questioning. A stack nobody can defend is worse
   than a smaller one that is fully understood.
2. Timing must be accurate and solve data must never be lost. Those are the two failures
   that would make the product untrustworthy.

An initial draft of this stack was rejected as too complex. It carried roughly twenty
technologies, including four workspace packages, Drizzle, react-three-fiber, Radix UI and
Testcontainers. This record documents the leaner replacement.

## Decision

| Concern         | Choice                                                          |
| --------------- | --------------------------------------------------------------- |
| Language        | TypeScript, strict, everywhere                                  |
| Package manager | pnpm workspaces                                                 |
| Frontend        | React + Vite + React Router                                     |
| Server state    | TanStack Query                                                  |
| Styling         | Tailwind CSS, native HTML elements                              |
| Cube rendering  | CSS 3D transforms                                               |
| Backend         | Fastify                                                         |
| Validation      | Zod, shared between client and server                           |
| Database        | PostgreSQL                                                      |
| Database access | Prisma                                                          |
| Auth            | Opaque session tokens in httpOnly cookies                       |
| Scrambles       | `cubing.js` behind our own provider interface                   |
| Testing         | Vitest, Testing Library, Playwright, Postgres in Docker Compose |

TypeScript is pinned to 6.0.3 rather than the newer 7.0.2. TypeScript 7 is the native
compiler rewrite and `typescript-eslint` does not yet support it. The linting ecosystem,
not the compiler, is the binding constraint.

## Consequences

**Made easier.** The client/server boundary is an explicit HTTP contract, which is simple
to reason about and simple to describe. The domain layer is pure TypeScript, so it is fast
to test and runs unchanged in either process. Session revocation is a single row delete.

**Made harder.** Two deployment targets instead of one. CORS and cookie configuration must
be correct across origins. No server-side rendering, which is irrelevant for an app behind
a login but would matter if a public marketing surface is added later.

**Deferred costs.** CSS 3D transforms will not carry animated layer turns comfortably; a
move to Three.js is expected when solve replay is built. Prisma will need raw SQL if
statistics grow beyond what the query builder expresses well.

## Alternatives considered

**Next.js instead of a separate API.** Fewer moving parts and a single deploy. Rejected
because server actions hide the client/server boundary, and that boundary is both the most
valuable thing to learn here and the thing most often asked about in interviews.

**Drizzle instead of Prisma.** Drizzle was the original recommendation, justified by
statistics being SQL-heavy. That justification collapsed once the averaging rules moved
into TypeScript (see ADR-0002): the database is left doing filtering, pagination and simple
aggregates, all of which Prisma handles well, with friendlier migrations.

**JWT access and refresh tokens.** The industry default. Rejected because its benefit is
statelessness across many services, and there is one API here. The costs — difficult
revocation, rotation with reuse detection, a large footgun surface — are real and immediate.
JWTs can be added later for mobile or third-party clients specifically.

**A managed auth provider (Clerk, Supabase Auth, Auth0).** Would reduce authentication to an
afternoon. Rejected because implementing it once by hand is among the most interview-relevant
things in the project.

**Writing our own scramble generator.** Proper WCA scrambles are random-state, produced by
solving a random position with a two-phase solver. Building that is weeks of work and is not
the MVP. `cubing.js` sits behind a `ScrambleProvider` interface so the decision is reversible.
