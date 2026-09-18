import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './api-client.js';

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
    ...response,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  /**
   * The single most important behaviour in this file. Without `credentials: 'include'`
   * the browser silently drops the session cookie on cross-origin requests, and every
   * call looks logged out with no error explaining why.
   */
  it('sends credentials, so the session cookie crosses origins', async () => {
    const fetchMock = mockFetch({ json: () => Promise.resolve({ ok: true }) });

    await apiRequest('/auth/me');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/me'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('returns the parsed body on success', async () => {
    mockFetch({ json: () => Promise.resolve({ user: { email: 'a@b.com' } }) });

    await expect(apiRequest('/auth/me')).resolves.toEqual({ user: { email: 'a@b.com' } });
  });

  it('returns undefined for 204, which has no body to parse', async () => {
    mockFetch({ status: 204, json: () => Promise.reject(new Error('no body')) });

    await expect(apiRequest('/auth/logout')).resolves.toBeUndefined();
  });

  it('turns an API error body into an ApiError carrying the code', async () => {
    mockFetch({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { code: 'INVALID_CREDENTIALS', message: 'Nope' } }),
    });

    await expect(apiRequest('/auth/login')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Nope',
    });
  });

  it('still produces an ApiError when the error body is not the expected shape', async () => {
    mockFetch({ ok: false, status: 500, json: () => Promise.reject(new Error('html')) });

    const failure = await apiRequest('/anything').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(500);
  });

  it('reports a failed connection as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiRequest('/auth/me')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
