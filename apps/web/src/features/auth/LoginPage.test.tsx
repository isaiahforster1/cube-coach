import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render.js';
import { LoginPage } from './LoginPage.js';

/** Respond to /auth/me as logged out, and to anything else with the given reply. */
function mockApi(reply: { ok: boolean; status: number; body: unknown }) {
  const fetchMock = vi.fn((url: string, _options?: RequestInit) => {
    if (url.includes('/auth/me')) {
      return Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { code: 'NOT_AUTHENTICATED' } }),
      });
    }
    return Promise.resolve({
      ok: reply.ok,
      status: reply.status,
      json: () => Promise.resolve(reply.body),
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginPage', () => {
  it('labels every field, so the form is usable without sight', () => {
    mockApi({ ok: true, status: 200, body: {} });
    renderWithProviders(<LoginPage />);

    // getByLabelText only finds an input if the label is genuinely associated with it.
    // If this passes, a screen reader announces the field correctly too.
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('rejects a malformed email without contacting the server', async () => {
    const fetchMock = mockApi({ ok: true, status: 200, body: {} });
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'some-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/invalid email/iu)).toBeInTheDocument();

    // Only the session check should have happened: no login request was sent.
    const loginCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/login'));
    expect(loginCalls).toHaveLength(0);
  });

  it('marks an invalid field with aria-invalid', async () => {
    mockApi({ ok: true, status: 200, body: {} });
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'nope');
    await user.type(screen.getByLabelText('Password'), 'some-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    });
  });

  it('submits valid credentials to the API', async () => {
    const fetchMock = mockApi({
      ok: true,
      status: 200,
      body: { user: { id: '1', email: 'cuber@example.com', displayName: 'C', createdAt: '' } },
    });
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'cuber@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-real-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      const loginCall = fetchMock.mock.calls.find(([candidate]) =>
        String(candidate).includes('/auth/login'),
      );
      expect(loginCall).toBeDefined();
      expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({
        email: 'cuber@example.com',
        password: 'a-real-password',
      });
    });
  });

  it('announces a rejected sign-in to assistive technology', async () => {
    mockApi({
      ok: false,
      status: 401,
      body: { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } },
    });
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'cuber@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password-x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // role="alert" is what makes a screen reader read this out when it appears. Without
    // it, a failed sign-in is silent to anyone not watching that part of the page.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Email or password is incorrect');
  });
});
