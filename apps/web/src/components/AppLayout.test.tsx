import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/render.js';
import { AppLayout } from './AppLayout.js';

/** Signed in until a sign-out request succeeds, then signed out, like the real API. */
function mockSignedIn() {
  let signedIn = true;

  const fetchMock = vi.fn((url: string, options?: RequestInit) => {
    if (url.includes('/auth/me')) {
      return Promise.resolve(
        signedIn
          ? {
              ok: true,
              status: 200,
              json: () =>
                Promise.resolve({
                  user: {
                    id: 'u1',
                    email: 'a@b.test',
                    displayName: 'Cuber',
                    emailVerified: true,
                    createdAt: '',
                  },
                }),
            }
          : {
              ok: false,
              status: 401,
              json: () => Promise.resolve({ error: { code: 'NOT_AUTHENTICATED' } }),
            },
      );
    }

    if (url.includes('/auth/logout') && options?.method === 'POST') {
      signedIn = false;
      return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(undefined) });
    }

    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function posts(
  fetchMock: { mock: { calls: readonly (readonly [string, (RequestInit | undefined)?])[] } },
  path: string,
) {
  return fetchMock.mock.calls.filter(
    ([url, options]) => String(url).endsWith(path) && options?.method === 'POST',
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * After a lost phone or a suspected compromise, ending every login the user cannot see is
 * the one thing they need, and it has to be reachable from any device they still have.
 */
describe('signing out everywhere', () => {
  it('ends every session once confirmed, and shows the user as signed out', async () => {
    const fetchMock = mockSignedIn();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const user = userEvent.setup();
    renderWithProviders(<AppLayout>page</AppLayout>);

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));

    await waitFor(() => expect(posts(fetchMock, '/auth/logout-all')).toHaveLength(1));
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  /** It signs out this device too, which is surprising enough to ask first. */
  it('does nothing if the user changes their mind', async () => {
    const fetchMock = mockSignedIn();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    const user = userEvent.setup();
    renderWithProviders(<AppLayout>page</AppLayout>);

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));

    expect(posts(fetchMock, '/auth/logout-all')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
  });

  it('is not offered to a guest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: { code: 'NOT_AUTHENTICATED' } }),
        }),
      ),
    );
    renderWithProviders(<AppLayout>page</AppLayout>);

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull();
  });
});

/**
 * Both sign-out actions live behind one Account button, so the header on a phone is no
 * wider than it was with a single Sign out button. A second button squeezed the page
 * navigation down to nothing.
 */
describe('account menu', () => {
  it('starts closed and says so', async () => {
    mockSignedIn();
    renderWithProviders(<AppLayout>page</AppLayout>);

    const account = await screen.findByRole('button', { name: 'Account' });

    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('signs out of this device only', async () => {
    const fetchMock = mockSignedIn();
    const user = userEvent.setup();
    renderWithProviders(<AppLayout>page</AppLayout>);

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    expect(screen.getByRole('button', { name: 'Account' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(posts(fetchMock, '/auth/logout')).toHaveLength(1));
    expect(posts(fetchMock, '/auth/logout-all')).toHaveLength(0);
  });

  it('closes on Escape', async () => {
    mockSignedIn();
    const user = userEvent.setup();
    renderWithProviders(<AppLayout>page</AppLayout>);

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('closes on a click anywhere else', async () => {
    mockSignedIn();
    const user = userEvent.setup();
    renderWithProviders(<AppLayout>page</AppLayout>);

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    await user.click(screen.getByText('page'));

    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });
});

/**
 * An unconfirmed address is mentioned inside the account menu and nowhere else. The
 * account works without it (ADR-0012), so it earns no banner, but someone who wants their
 * password to survive a later Google sign-in needs a way to confirm it.
 */
describe('email confirmation in the account menu', () => {
  function mockAccount({ verified, available }: { verified: boolean; available: boolean }) {
    const fetchMock = vi.fn((url: string, _options?: RequestInit) => {
      const json = (body: unknown) => Promise.resolve(body);
      if (url.endsWith('/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            json({
              user: {
                id: 'u1',
                email: 'a@b.test',
                displayName: 'Cuber',
                emailVerified: verified,
                createdAt: '',
              },
            }),
        });
      }
      if (url.endsWith('/auth/providers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => json({ password: true, google: false, emailVerification: available }),
        });
      }
      return Promise.resolve({ ok: true, status: 204, json: () => json(undefined) });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('offers a new link when the address is not confirmed', async () => {
    const fetchMock = mockAccount({ verified: false, available: true });
    const user = userEvent.setup();
    renderWithProviders(<AppLayout>page</AppLayout>);

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    expect(await screen.findByText('Email not confirmed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send a new link' }));

    await waitFor(() => expect(posts(fetchMock, '/auth/resend-verification')).toHaveLength(1));
    expect(await screen.findByRole('status')).toHaveTextContent(/on its way/iu);
  });

  it('says nothing once the address is confirmed', async () => {
    mockAccount({ verified: true, available: true });
    const user = userEvent.setup();
    renderWithProviders(<AppLayout>page</AppLayout>);

    await user.click(await screen.findByRole('button', { name: 'Account' }));

    expect(screen.queryByText('Email not confirmed')).toBeNull();
  });

  /** A button that can only fail is worse than none. */
  it('says nothing when the server cannot send email', async () => {
    const fetchMock = mockAccount({ verified: false, available: false });
    const user = userEvent.setup();
    renderWithProviders(<AppLayout>page</AppLayout>);

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/providers'))).toBe(
        true,
      ),
    );

    expect(screen.queryByText('Email not confirmed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send a new link' })).toBeNull();
  });
});
