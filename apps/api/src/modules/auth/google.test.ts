import { describe, expect, it, vi } from 'vitest';
import { createGoogleOAuth, createOAuthState } from './google.js';

const config = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost:3000/api/v1/auth/google/callback',
};

/** Stand in for Google, so the flow can be exercised without credentials or a network. */
function fakeGoogle(
  responses: { token?: unknown; tokenOk?: boolean; profile?: unknown; profileOk?: boolean } = {},
) {
  return vi.fn((url: string | URL | Request, _options?: RequestInit) => {
    const href = String(url);

    if (href.includes('/token')) {
      return Promise.resolve({
        ok: responses.tokenOk ?? true,
        status: (responses.tokenOk ?? true) ? 200 : 400,
        json: () => Promise.resolve(responses.token ?? { access_token: 'an-access-token' }),
      } as Response);
    }

    return Promise.resolve({
      ok: responses.profileOk ?? true,
      status: (responses.profileOk ?? true) ? 200 : 401,
      json: () =>
        Promise.resolve(
          responses.profile ?? {
            sub: 'google-subject-1',
            email: 'Cuber@Example.com',
            email_verified: true,
            name: 'Test Cuber',
          },
        ),
    } as Response);
  });
}

describe('createOAuthState', () => {
  it('produces a different value every time', () => {
    const states = new Set(Array.from({ length: 50 }, () => createOAuthState()));
    expect(states.size).toBe(50);
  });

  it('is long enough not to be guessable', () => {
    expect(createOAuthState().length).toBeGreaterThan(20);
  });
});

describe('authorizationUrl', () => {
  it('sends the browser to Google with the state attached', () => {
    const url = new URL(createGoogleOAuth(config).authorizationUrl('the-state'));

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('state')).toBe('the-state');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  /** Only what is needed to identify the account; more would be intrusive and off-putting. */
  it('asks for no more than identity', () => {
    const url = new URL(createGoogleOAuth(config).authorizationUrl('s'));
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });

  it('never puts the client secret in a URL the browser can see', () => {
    const url = createGoogleOAuth(config).authorizationUrl('s');
    expect(url).not.toContain('test-client-secret');
  });
});

describe('fetchProfile', () => {
  it('exchanges the code and returns the profile', async () => {
    const profile = await createGoogleOAuth(config, fakeGoogle()).fetchProfile('a-code');

    expect(profile).toEqual({
      sub: 'google-subject-1',
      email: 'cuber@example.com',
      emailVerified: true,
      name: 'Test Cuber',
    });
  });

  /** The same normalisation the password flow uses, so the two cannot create two accounts. */
  it('normalises the email', async () => {
    const profile = await createGoogleOAuth(config, fakeGoogle()).fetchProfile('a-code');
    expect(profile.email).toBe('cuber@example.com');
  });

  it('sends the secret in the request body, not the query string', async () => {
    const httpFetch = fakeGoogle();
    await createGoogleOAuth(config, httpFetch).fetchProfile('a-code');

    const call = httpFetch.mock.calls[0];
    expect(call).toBeDefined();
    const [url, options] = call!;
    expect(String(url)).not.toContain('test-client-secret');
    expect(String(options?.body)).toContain('test-client-secret');
  });

  it('reports an unverified email rather than hiding it', async () => {
    const profile = await createGoogleOAuth(
      config,
      fakeGoogle({
        profile: { sub: 's', email: 'a@b.com', email_verified: false, name: 'A' },
      }),
    ).fetchProfile('a-code');

    expect(profile.emailVerified).toBe(false);
  });

  it('treats a missing verification flag as unverified', async () => {
    const profile = await createGoogleOAuth(
      config,
      fakeGoogle({ profile: { sub: 's', email: 'a@b.com', name: 'A' } }),
    ).fetchProfile('a-code');

    expect(profile.emailVerified).toBe(false);
  });

  it('fails when Google rejects the code', async () => {
    await expect(
      createGoogleOAuth(config, fakeGoogle({ tokenOk: false })).fetchProfile('bad-code'),
    ).rejects.toThrow(/rejected the authorization code/iu);
  });

  it('fails when no access token comes back', async () => {
    await expect(
      createGoogleOAuth(config, fakeGoogle({ token: {} })).fetchProfile('a-code'),
    ).rejects.toThrow(/did not return an access token/iu);
  });

  it('fails when the profile cannot be read', async () => {
    await expect(
      createGoogleOAuth(config, fakeGoogle({ profileOk: false })).fetchProfile('a-code'),
    ).rejects.toThrow(/could not read the google profile/iu);
  });

  it('fails on a profile without a subject', async () => {
    await expect(
      createGoogleOAuth(config, fakeGoogle({ profile: { email: 'a@b.com' } })).fetchProfile('c'),
    ).rejects.toThrow(/unusable profile/iu);
  });
});
