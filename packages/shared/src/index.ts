/**
 * Shared domain code used by both the web client and the API.
 *
 * This package deliberately depends on no framework: no React, no Fastify, no
 * database client. It is plain TypeScript over plain data, which is what makes
 * it fast to test and safe to run in either process.
 *
 * Nothing real lives here yet. M1 adds the cube engine (state, moves, notation),
 * M2 adds scramble generation, and M9 adds the statistics rules. The placeholder
 * below exists only so the workspace, type checking, linting and the test runner
 * are proven end to end before any real logic depends on them.
 */
export const PACKAGE_NAME = '@cube-coach/shared';
