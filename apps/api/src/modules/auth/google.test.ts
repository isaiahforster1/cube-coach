import { describe, expect, it, vi } from 'vitest';
import {
  createGoogleOAuth,
  createOAuthState,
  createPkceVerifier,
  pkceChallenge,
} from './google.js';

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

/**
 * PKCE binds the authorization code to the browser session that asked for it. The code
 * travels through URLs, which end up in history, proxy logs and Referer headers; the
 * verifier never leaves our cookie and our server, and Google will not exchange the code
 * without it.
 */
describe('PKCE', () => {
  it('makes a verifier of the length RFC 7636 requires, fresh every time', () => {
    const verifier = createPkceVerifier();

    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/u);
    expect(createPkceVerifier()).not.toBe(verifier);
  });

  /** The worked example from RFC 7636, appendix B. */
  it('derives the S256 challenge exactly as the specification does', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('sends the challenge, and says it is S256', () => {
    const url = new URL(createGoogleOAuth(config).authorizationUrl('s', 'the-challenge'));

    expect(url.searchParams.get('code_challenge')).toBe('the-challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('never puts the verifier in the URL', () => {
    const verifier = createPkceVerifier();
    const url = createGoogleOAuth(config).authorizationUrl('s', pkceChallenge(verifier));

    expect(url).not.toContain(verifier);
  });

  it('presents the verifier when exchanging the code', async () => {
    const httpFetch = fakeGoogle();
    await createGoogleOAuth(config, httpFetch).fetchProfile('a-code', 'the-verifier');

    const [, options] = httpFetch.mock.calls[0]!;
    expect(new URLSearchParams(String(options?.body)).get('code_verifier')).toBe('the-verifier');
  });
});

describe('authorizationUrl', () => {
  it('sends the browser to Google with the state attached', () => {
    const url = new URL(createGoogleOAuth(config).authorizationUrl('the-state', 'the-challenge'));

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('state')).toBe('the-state');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  /** Only what is needed to identify the account; more would be intrusive and off-putting. */
  it('asks for no more than identity', () => {
    const url = new URL(createGoogleOAuth(config).authorizationUrl('s', 'c'));
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });

  it('never puts the client secret in a URL the browser can see', () => {
    const url = createGoogleOAuth(config).authorizationUrl('s', 'c');
    expect(url).not.toContain('test-client-secret');
  });
});

describe('fetchProfile', () => {
  it('exchanges the code and returns the profile', async () => {
    const profile = await createGoogleOAuth(config, fakeGoogle()).fetchProfile(
      'a-code',
      'a-verifier',
    );

    expect(profile).toEqual({
      sub: 'google-subject-1',
      email: 'cuber@example.com',
      emailVerified: true,
      name: 'Test Cuber',
    });
  });

  /** The same normalisation the password flow uses, so the two cannot create two accounts. */
  it('normalises the email', async () => {
    const profile = await createGoogleOAuth(config, fakeGoogle()).fetchProfile(
      'a-code',
      'a-verifier',
    );
    expect(profile.email).toBe('cuber@example.com');
  });

  it('sends the secret in the request body, not the query string', async () => {
    const httpFetch = fakeGoogle();
    await createGoogleOAuth(config, httpFetch).fetchProfile('a-code', 'a-verifier');

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
    ).fetchProfile('a-code', 'a-verifier');

    expect(profile.emailVerified).toBe(false);
  });

  it('treats a missing verification flag as unverified', async () => {
    const profile = await createGoogleOAuth(
      config,
      fakeGoogle({ profile: { sub: 's', email: 'a@b.com', name: 'A' } }),
    ).fetchProfile('a-code', 'a-verifier');

    expect(profile.emailVerified).toBe(false);
  });

  it('fails when Google rejects the code', async () => {
    await expect(
      createGoogleOAuth(config, fakeGoogle({ tokenOk: false })).fetchProfile(
        'bad-code',
        'a-verifier',
      ),
    ).rejects.toThrow(/rejected the authorization code/iu);
  });

  it('fails when no access token comes back', async () => {
    await expect(
      createGoogleOAuth(config, fakeGoogle({ token: {} })).fetchProfile('a-code', 'a-verifier'),
    ).rejects.toThrow(/did not return an access token/iu);
  });

  it('fails when the profile cannot be read', async () => {
    await expect(
      createGoogleOAuth(config, fakeGoogle({ profileOk: false })).fetchProfile(
        'a-code',
        'a-verifier',
      ),
    ).rejects.toThrow(/could not read the google profile/iu);
  });

  it('fails on a profile without a subject', async () => {
    await expect(
      createGoogleOAuth(config, fakeGoogle({ profile: { email: 'a@b.com' } })).fetchProfile(
        'c',
        'a-verifier',
      ),
    ).rejects.toThrow(/unusable profile/iu);
  });
});
