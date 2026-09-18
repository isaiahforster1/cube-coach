import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Solve } from '@cube-coach/shared';
import { renderWithProviders } from '../../test/render.js';
import { HistoryPage } from './HistoryPage.js';

function solve(overrides: Partial<Solve> = {}): Solve {
  return {
    id: crypto.randomUUID(),
    practiceSessionId: '00000000-0000-4000-8000-000000000001',
    scramble: "R U R' U' F2 D",
    durationMs: 12_340,
    penalty: 'none',
    comment: null,
    solvedAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  };
}

/** Route requests by path, so one mock serves the session check and the history. */
function mockApi(routes: {
  pages?: { solves: Solve[]; nextCursor: string | null }[];
  onRequest?: (url: string, options?: RequestInit) => void;
}) {
  const pages = routes.pages ?? [{ solves: [], nextCursor: null }];
  let pageIndex = 0;

  const fetchMock = vi.fn((url: string, options?: RequestInit) => {
    routes.onRequest?.(url, options);

    if (url.includes('/auth/me')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ user: { id: '1', email: 'a@b.com', displayName: 'C', createdAt: '' } }),
      });
    }

    if (url.includes('/solves') && (options?.method ?? 'GET') === 'GET') {
      const page = pages[Math.min(pageIndex, pages.length - 1)];
      pageIndex += 1;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(page) });
    }

    return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HistoryPage', () => {
  it('says so when there are no solves, rather than showing an empty list', async () => {
    mockApi({});
    renderWithProviders(<HistoryPage />);

    expect(await screen.findByText(/no solves yet/iu)).toBeInTheDocument();
  });

  it('lists solves with their formatted times', async () => {
    mockApi({
      pages: [
        {
          solves: [solve({ durationMs: 12_340 }), solve({ durationMs: 9_990 })],
          nextCursor: null,
        },
      ],
    });
    renderWithProviders(<HistoryPage />);

    expect(await screen.findByText('12.34')).toBeInTheDocument();
    expect(screen.getByText('9.99')).toBeInTheDocument();
  });

  it('shows a penalised time with its marker and a DNF as DNF', async () => {
    mockApi({
      pages: [
        {
          solves: [
            solve({ durationMs: 12_340, penalty: 'plus2' }),
            solve({ durationMs: 8_000, penalty: 'dnf' }),
          ],
          nextCursor: null,
        },
      ],
    });
    renderWithProviders(<HistoryPage />);

    expect(await screen.findByText('14.34+')).toBeInTheDocument();

    // Scoped to the time cell: "DNF" also appears on the penalty button in every row.
    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[1]!).getByText('DNF', { selector: 'span' })).toBeInTheDocument();
  });

  /** Cubers count a session from the first solve, so the newest carries the highest number. */
  it('numbers solves oldest-first even though they are listed newest-first', async () => {
    mockApi({
      pages: [
        {
          solves: [
            solve({ durationMs: 30_000 }),
            solve({ durationMs: 20_000 }),
            solve({ durationMs: 10_000 }),
          ],
          nextCursor: null,
        },
      ],
    });
    renderWithProviders(<HistoryPage />);

    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[0]!).getByText('3')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('1')).toBeInTheDocument();
  });

  it('fetches the next page with the cursor the server returned', async () => {
    const requests: string[] = [];
    mockApi({
      pages: [
        { solves: [solve({ durationMs: 10_000 })], nextCursor: 'cursor-from-server' },
        { solves: [solve({ durationMs: 20_000 })], nextCursor: null },
      ],
      onRequest: (url) => requests.push(url),
    });

    const user = userEvent.setup();
    renderWithProviders(<HistoryPage />);

    await user.click(await screen.findByRole('button', { name: 'Load more' }));

    await waitFor(() => {
      expect(requests.some((url) => url.includes('cursor=cursor-from-server'))).toBe(true);
    });
    expect(await screen.findByText('20.00')).toBeInTheDocument();
  });

  it('hides the load-more button on the last page', async () => {
    mockApi({ pages: [{ solves: [solve()], nextCursor: null }] });
    renderWithProviders(<HistoryPage />);

    await screen.findByText('12.34');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  /**
   * Undo rather than a confirmation dialogue: a confirmation interrupts every delete to
   * guard against the rare mistaken one.
   */
  it('offers undo after deleting', async () => {
    mockApi({ pages: [{ solves: [solve()], nextCursor: null }] });
    const user = userEvent.setup();
    renderWithProviders(<HistoryPage />);

    await user.click(await screen.findByRole('button', { name: /delete solve/iu }));

    expect(await screen.findByText('Solve deleted.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('calls the restore endpoint when undo is used', async () => {
    const requests: { url: string; method: string }[] = [];
    mockApi({
      pages: [{ solves: [solve()], nextCursor: null }],
      onRequest: (url, options) => requests.push({ url, method: options?.method ?? 'GET' }),
    });

    const user = userEvent.setup();
    renderWithProviders(<HistoryPage />);

    await user.click(await screen.findByRole('button', { name: /delete solve/iu }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => {
      expect(requests.some((r) => r.url.includes('/restore') && r.method === 'POST')).toBe(true);
    });
  });

  it('sends a penalty change to the API', async () => {
    const requests: { url: string; method: string; body: unknown }[] = [];
    mockApi({
      pages: [{ solves: [solve()], nextCursor: null }],
      onRequest: (url, options) =>
        requests.push({
          url,
          method: options?.method ?? 'GET',
          body: options?.body === undefined ? null : JSON.parse(String(options.body)),
        }),
    });

    const user = userEvent.setup();
    renderWithProviders(<HistoryPage />);

    await user.click(await screen.findByRole('button', { name: '+2' }));

    await waitFor(() => {
      const patch = requests.find((r) => r.method === 'PATCH');
      expect(patch?.body).toEqual({ penalty: 'plus2' });
    });
  });
});
