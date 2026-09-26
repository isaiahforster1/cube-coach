import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const valid = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' };

describe('loadConfig', () => {
  it('accepts a minimal valid environment', () => {
    const config = loadConfig(valid);
    expect(config.DATABASE_URL).toBe(valid.DATABASE_URL);
  });

  it('applies defaults for anything optional', () => {
    const config = loadConfig(valid);
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('coerces PORT from the string the environment provides', () => {
    const config = loadConfig({ ...valid, PORT: '8080' });
    expect(config.PORT).toBe(8080);
  });

  it('fails when DATABASE_URL is missing, naming the variable', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/u);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ ...valid, PORT: '99999' })).toThrow(/PORT/u);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/u);
  });

  /**
   * The development default must not leak into production. It did: production ran with
   * `http://localhost:5173` as its web origin, sending Google sign-ins there and telling
   * browsers that page could make credentialed requests.
   */
  it('has no web origin in production unless one is set', () => {
    expect(loadConfig({ ...valid, NODE_ENV: 'production' }).WEB_ORIGIN).toBeUndefined();
    expect(loadConfig(valid).WEB_ORIGIN).toBe('http://localhost:5173');
  });

  it('rejects a web origin that is not a URL', () => {
    expect(() => loadConfig({ ...valid, WEB_ORIGIN: 'localhost' })).toThrow(/WEB_ORIGIN/u);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ ...valid, LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/u);
  });
});
