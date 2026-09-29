import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link } from 'react-router';
import type { PublicUser } from '@cube-coach/shared';
import { renderWithProviders } from '../../test/render.js';
import { VerifyEmailPage } from './VerifyEmailPage.js';

const TOKEN = 'A'.repeat(43);

function signedInUser(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: 'u1',
    email: 'cuber@example.com',
    displayName: 'Cuber',
    emailVerified: false,
    createdAt: '',
    ...overrides,
  };
}

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

function reply({ status, body }: Reply) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  });
}

/** Answer /auth/me with the given user (null for signed out), and the two verify calls. */
function mockApi({
  user,
  verify = { status: 200, body: { user: signedInUser({ emailVerified: true }) } },
  resend = { status: 204 },
}: {
  user: PublicUser | null;
  verify?: Reply;
  resend?: Reply;
}) {
  const fetchMock = vi.fn((url: string, _options?: RequestInit) => {
    if (url.endsWith('/auth/me')) {
      return user === null
        ? reply({ status: 401, body: { error: { code: 'NOT_AUTHENTICATED' } } })
        : reply({ status: 200, body: { user } });
    }
    if (url.endsWith('/auth/verify-email')) return reply(verify);
    if (url.endsWith('/auth/resend-verification')) return reply(resend);
    return reply({ status: 404, body: {} });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function callsTo(fetchMock: ReturnType<typeof mockApi>, path: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(path));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VerifyEmailPage', () => {
  it('sends the token from the link once and confirms the address', async () => {
    const fetchMock = mockApi({ user: signedInUser() });

    renderWithProviders(<VerifyEmailPage />, { route: `/verify-email#token=${TOKEN}` });

    expect(await screen.findByText('Your email address is confirmed.')).toBeInTheDocument();
    const calls = callsTo(fetchMock, '/auth/verify-email');
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({ token: TOKEN });
  });

  /**
   * The server needs the session as well as the token, so a signed-out visitor is asked
   * to sign in and is brought back here afterwards, rather than shown a failure.
   */
  it('asks a signed-out visitor to sign in first, without sending the token', async () => {
    const fetchMock = mockApi({ user: null });

    renderWithProviders(<VerifyEmailPage />, { route: `/verify-email#token=${TOKEN}` });

    expect(await screen.findByRole('link', { name: 'Sign in to confirm' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(callsTo(fetchMock, '/auth/verify-email')).toHaveLength(0);
  });

  it('says so when the link has no token', async () => {
    const fetchMock = mockApi({ user: signedInUser() });

    renderWithProviders(<VerifyEmailPage />, { route: '/verify-email' });

    expect(await screen.findByText(/link is incomplete/iu)).toBeInTheDocument();
    expect(callsTo(fetchMock, '/auth/verify-email')).toHaveLength(0);
  });

  it('does not spend the token when the address is already confirmed', async () => {
    const fetchMock = mockApi({ user: signedInUser({ emailVerified: true }) });

    renderWithProviders(<VerifyEmailPage />, { route: `/verify-email#token=${TOKEN}` });

    expect(await screen.findByText('Your email address is confirmed.')).toBeInTheDocument();
    expect(callsTo(fetchMock, '/auth/verify-email')).toHaveLength(0);
  });

  /**
   * Someone who asks for a new link here may open it in this same tab. Only the fragment
   * changes, so the browser does not reload, and the page must pick up the new token.
   */
  it('uses a newer link opened while the page is showing', async () => {
    const newer = 'B'.repeat(43);
    const fetchMock = mockApi({
      user: signedInUser(),
      verify: { status: 400, body: { error: { code: 'VERIFICATION_LINK_INVALID', message: 'x' } } },
    });
    const user = userEvent.setup();

    renderWithProviders(
      <>
        <VerifyEmailPage />
        <Link to={`/verify-email#token=${newer}`}>newer link</Link>
      </>,
      { route: `/verify-email#token=${TOKEN}` },
    );
    await screen.findByRole('alert');
    await user.click(screen.getByRole('link', { name: 'newer link' }));

    await waitFor(() => expect(callsTo(fetchMock, '/auth/verify-email')).toHaveLength(2));
    const bodies = callsTo(fetchMock, '/auth/verify-email').map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(bodies).toEqual([{ token: TOKEN }, { token: newer }]);
  });

  it('offers a new link when this one has expired', async () => {
    const fetchMock = mockApi({
      user: signedInUser(),
      verify: {
        status: 400,
        body: {
          error: {
            code: 'VERIFICATION_LINK_INVALID',
            message: 'This link is invalid or has expired. You can ask for a new one.',
          },
        },
      },
    });
    const user = userEvent.setup();

    renderWithProviders(<VerifyEmailPage />, { route: `/verify-email#token=${TOKEN}` });

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/iu);
    await user.click(screen.getByRole('button', { name: 'Send a new link' }));

    await waitFor(() => expect(callsTo(fetchMock, '/auth/resend-verification')).toHaveLength(1));
    expect(await screen.findByText(/new link is on its way/iu)).toBeInTheDocument();
  });
});
