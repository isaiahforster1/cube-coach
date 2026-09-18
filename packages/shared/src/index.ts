/**
 * Shared domain code used by both the web client and the API.
 *
 * This package deliberately depends on no framework: no React, no Fastify, no
 * database client. It is plain TypeScript over plain data, which is what makes it
 * fast to test and safe to run in either process.
 */
export * from './cube/index.js';
export * from './scramble/index.js';
export * from './contracts/index.js';
export * from './timer/index.js';
