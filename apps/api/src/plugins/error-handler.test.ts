import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError, registerErrorHandler } from './error-handler.js';

/** A small app with deliberately failing routes, so each branch can be exercised. */
function buildFailingApp(isProduction: boolean): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app, { isProduction });

  app.get('/api-error', () => {
    throw new ApiError(409, 'ALREADY_EXISTS', 'That already exists', { field: 'email' });
  });

  app.get('/zod-error', () => {
    z.object({ name: z.string() }).parse({ name: 42 });
  });

  app.get('/unexpected', () => {
    throw new Error('Connection string: postgres://secret@internal-host/db');
  });

  app.post('/echo', (request) => request.body);

  return app;
}

describe('error handler', () => {
  it('returns the status, code and details of an ApiError', async () => {
    const response = await buildFailingApp(false).inject({ method: 'GET', url: '/api-error' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: 'ALREADY_EXISTS',
        message: 'That already exists',
        details: { field: 'email' },
      },
    });
  });

  it('turns a validation failure into a 400 with the failing fields', async () => {
    const response = await buildFailingApp(false).inject({ method: 'GET', url: '/zod-error' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(response.json().error.details).toBeInstanceOf(Array);
  });

  it('returns a 404 in the same shape as every other error', async () => {
    const response = await buildFailingApp(false).inject({ method: 'GET', url: '/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed JSON with a 400 rather than a crash', async () => {
    const response = await buildFailingApp(false).inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBeDefined();
  });

  it('shows the underlying message outside production, to help debugging', async () => {
    const response = await buildFailingApp(false).inject({ method: 'GET', url: '/unexpected' });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.message).toContain('postgres://');
  });

  it('hides internal details in production', async () => {
    const response = await buildFailingApp(true).inject({ method: 'GET', url: '/unexpected' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
    // The point of the test: no credentials, host names or stack traces leak to a client.
    expect(response.body).not.toContain('postgres://');
  });
});
