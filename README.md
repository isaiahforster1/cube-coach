# CubeCoach

A Rubik's Cube training platform.

A timer tells you how fast you solved. CubeCoach is being built to tell you _why_ you are
solving at the speed you are, and what to practise next.

## Status

Early development. **M6 complete** — a working timer with inspection and penalties. Solves are not yet saved.

| Milestone | Scope                                                  | State   |
| --------- | ------------------------------------------------------ | ------- |
| M0        | Repo foundation: workspace, TypeScript, lint, CI, docs | ✅ Done |
| M1        | Cube engine: state, moves, notation                    | ✅ Done |
| M2        | Scramble generation                                    | ✅ Done |
| M3        | API skeleton and database                              | ✅ Done |
| M4        | Authentication                                         | ✅ Done |
| M5        | Web shell                                              | ✅ Done |
| M6        | Timer                                                  | ✅ Done |
| M7        | Solve and session persistence                          | Next    |
| M8        | History                                                |         |
| M9        | Statistics and personal records                        |         |
| M10       | Interactive cube                                       |         |
| M11       | Algorithm library                                      |         |
| M12       | Hardening and deployment                               |         |

## Quick start

```bash
pnpm install
pnpm run check
```

Full setup instructions, including the Windows and Docker notes, are in
[docs/development.md](docs/development.md).

## Layout

```
apps/web         React client              (M5)
apps/api         Fastify server            (M3)
packages/shared  Cube engine, statistics, Zod schemas
docs/            Documentation and ADRs
```

## Documentation

- [Development setup](docs/development.md)
- [Database design](docs/database.md) — schema, indexes, and why solves are stored the way they are
- [Testing](docs/testing.md) — what is tested where, and what is deliberately not mocked
- [Architecture decisions](docs/architecture/) — why the stack and structure are what they are
- [Interview notes](docs/interview-notes.md) — what this project teaches, milestone by milestone

## Planned stack

TypeScript throughout. React, Vite and Tailwind on the client; Fastify, Prisma and PostgreSQL
on the server; Vitest and Playwright for tests. Reasoning for each choice is in
[ADR-0001](docs/architecture/0001-technology-stack.md).

AI coaching features are deliberately out of scope until the deterministic foundation —
cube logic, timing, statistics — is complete and well tested.
