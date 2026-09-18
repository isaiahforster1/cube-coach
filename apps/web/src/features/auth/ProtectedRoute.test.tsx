import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render.js';
import { ProtectedRoute } from './ProtectedRoute.js';

function mockSession(user: unknown | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      user === null
        ? Promise.resolve({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ error: { code: 'NOT_AUTHENTICATED' } }),
          })
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ user }) }),
    ),
  );
}

function renderGuardedApp() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<h1>Sign in</h1>} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<h1>Secret timer</h1>} />
      </Route>
    </Routes>,
    { route: '/' },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProtectedRoute', () => {
  it('shows the page to a signed-in user', async () => {
    mockSession({ id: '1', email: 'a@b.com', displayName: 'Cuber', createdAt: '' });
    renderGuardedApp();

    expect(await screen.findByText('Secret timer')).toBeInTheDocument();
  });

  it('redirects a signed-out user to the login page', async () => {
    mockSession(null);
    renderGuardedApp();

    expect(await screen.findByText('Sign in')).toBeInTheDocument();
    expect(screen.queryByText('Secret timer')).not.toBeInTheDocument();
  });

  /**
   * Without this, a hard refresh briefly renders the redirect before the session
   * request finishes, bouncing an authenticated user to the login page and back — a
   * visible flicker on every reload.
   */
  it('waits for the session check rather than redirecting immediately', () => {
    // A fetch that never settles, standing in for a request still in flight.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    renderGuardedApp();

    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
    expect(screen.queryByText('Secret timer')).not.toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
