import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test/context.js';

describe('security headers', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });

  afterAll(async () => {
    await context.close();
  });

  it('refuses to be framed, so the site cannot be used in a clickjacking overlay', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/health' });

    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('stops browsers guessing content types', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/health' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('keeps scripts to this origin', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/health' });
    const policy = response.headers['content-security-policy'] as string;

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
  });

  /**
   * Competition scrambles come from a solver compiled to WebAssembly, and instantiating
   * a WebAssembly module counts as compiling code. Without this the scramble generator
   * fails in production and nowhere else — the development server sends no policy at
   * all — which is the worst possible place to find out.
   */
  it('allows WebAssembly without allowing eval', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/health' });
    const policy = response.headers['content-security-policy'] as string;

    expect(policy).toContain("'wasm-unsafe-eval'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it('does not send HSTS from a development server', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/health' });

    // Sending it would poison the browser's HSTS list for localhost and break every
    // other project served from there over plain HTTP.
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('security headers in production', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext({ production: true });
  });

  afterAll(async () => {
    await context.close();
  });

  it('tells browsers to refuse plain HTTP in future', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/health' });

    expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
  });

  it('asks browsers to upgrade any insecure request', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/health' });

    expect(response.headers['content-security-policy']).toContain('upgrade-insecure-requests');
  });
});

describe('request limits', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });

  afterAll(async () => {
    await context.close();
  });

  it('rejects a body far larger than anything the app sends', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(200_000) }),
    });

    expect(response.statusCode).toBe(413);
  });
});

/**
 * In production one process serves both the API and the client, so that the session
 * cookie stays same-site. These cover the part that is easy to get subtly wrong: which
 * unknown URLs get the app shell and which get a 404.
 */
describe('serving the web client', () => {
  let context: TestContext;
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'cube-coach-web-'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>CubeCoach</title>');
    writeFileSync(join(root, 'app.js'), 'console.log("built");');

    context = await createTestContext({ webRoot: root });
  });

  afterAll(async () => {
    await context.close();
  });

  it('serves the built files', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/app.js' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('built');
  });

  /** A client route exists in the browser but not on disk, so a refresh must still work. */
  it('answers a client route with the app shell', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/stats',
      headers: { accept: 'text/html' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('CubeCoach');
  });

  /**
   * The mistake worth guarding against: answering an unknown API path with a page of
   * HTML turns a typo into a parse error somewhere far away, instead of the 404 it is.
   */
  it('still gives a 404 for an unknown API route', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/nonsense',
      headers: { accept: 'text/html' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('<!doctype html>');
  });

  it('still gives a 404 for an unknown health path', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/health/nonsense',
      headers: { accept: 'text/html' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('does not answer a non-GET request with the app shell', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/stats',
      headers: { accept: 'text/html' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('leaves the real API routes working', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/v1/auth/providers' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ password: true });
  });
});
