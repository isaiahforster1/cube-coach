import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createGuestStore, GUEST_PRACTICE_SESSION_ID } from '../solves/guest-store.js';
import { useGuestMigration } from './use-guest-migration.js';

const ACCOUNT_SESSION_ID = '11111111-1111-4111-8111-111111111111';

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

interface PostedSolve {
  practiceSessionId: string;
  id: string;
}

/** A signed-in API, recording every solve posted to it and every request that carried them. */
function mockSignedIn({ failUploads = false } = {}) {
  const posted: PostedSolve[] = [];
  const requests: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, options?: RequestInit) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ user: { id: 'u1', email: 'a@b', displayName: 'C', createdAt: '' } }),
        });
      }

      if (url.includes('/practice-sessions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              practiceSessions: [
                { id: ACCOUNT_SESSION_ID, name: 'Main', createdAt: '', archivedAt: null },
              ],
            }),
        });
      }

      if (url.includes('/solves') && options?.method === 'POST') {
        requests.push(url);
        if (failUploads) {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: { code: 'INTERNAL_ERROR' } }),
          });
        }
        const body = JSON.parse(String(options.body)) as { solves: PostedSolve[] };
        posted.push(...body.solves);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ solves: body.solves }),
        });
      }

      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }),
  );

  return Object.assign(posted, { requests });
}

async function seedGuestSolves(count: number) {
  const store = createGuestStore();
  for (let index = 0; index < count; index += 1) {
    await store.create({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      practiceSessionId: GUEST_PRACTICE_SESSION_ID,
      scramble: "R U R'",
      durationMs: 10_000 + index,
      penalty: 'none',
      solvedAt: new Date(Date.UTC(2026, 8, 18, 12) + index * 1000).toISOString(),
      comment: null,
    });
  }
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('guest migration', () => {
  it('does nothing when there are no guest solves', async () => {
    const posted = mockSignedIn();
    const { result } = renderHook(() => useGuestMigration(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(posted).toHaveLength(0);
  });

  /**
   * The behaviour that makes signing up safe. Without it, creating an account would
   * appear to delete everything a guest had done — punishing exactly the action the
   * product wants to encourage.
   */
  it('uploads the guest solves once signed in', async () => {
    const posted = mockSignedIn();
    await seedGuestSolves(3);

    const { result } = renderHook(() => useGuestMigration(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(posted).toHaveLength(3);
    expect(result.current.migratedCount).toBe(3);
  });

  /**
   * One request per solve would run into the per-account limit on single solves, which is
   * set for a person at a timer. A stored history goes through the batch endpoint instead.
   */
  it('uploads in batches of at most a hundred', async () => {
    const posted = mockSignedIn();
    await seedGuestSolves(250);

    const { result } = renderHook(() => useGuestMigration(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(posted).toHaveLength(250);
    expect(posted.requests).toHaveLength(3);
    expect(posted.requests.every((url) => url.endsWith('/solves/batch'))).toBe(true);
  });

  /** The guest placeholder session does not exist server-side, so each solve is re-pointed. */
  it('re-points each solve at the account’s own practice session', async () => {
    const posted = mockSignedIn();
    await seedGuestSolves(2);

    const { result } = renderHook(() => useGuestMigration(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('done'));

    expect(posted.every((solve) => solve.practiceSessionId === ACCOUNT_SESSION_ID)).toBe(true);
    expect(posted.some((solve) => solve.practiceSessionId === GUEST_PRACTICE_SESSION_ID)).toBe(
      false,
    );
  });

  it('keeps the original ids, so a repeated migration cannot duplicate anything', async () => {
    const posted = mockSignedIn();
    await seedGuestSolves(2);

    const { result } = renderHook(() => useGuestMigration(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('done'));

    expect(posted.map((solve) => solve.id)).toEqual([
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000001',
    ]);
  });

  it('clears the local copy only once everything is accepted', async () => {
    mockSignedIn();
    await seedGuestSolves(2);

    const { result } = renderHook(() => useGuestMigration(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('done'));

    expect(await createGuestStore().listAll()).toHaveLength(0);
  });

  /** A failed upload must not destroy the only copy of someone's solves. */
  it('leaves the solves in place when the upload fails', async () => {
    mockSignedIn({ failUploads: true });
    await seedGuestSolves(2);

    const { result } = renderHook(() => useGuestMigration(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('failed'));

    expect(await createGuestStore().listAll()).toHaveLength(2);
  });
});
