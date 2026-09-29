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

function posts(fetchMock: ReturnType<typeof mockSignedIn>, path: string) {
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
