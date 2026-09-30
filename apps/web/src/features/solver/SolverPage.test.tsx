import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SolverStepsResponse } from '@cube-coach/shared';
import { renderWithProviders } from '../../test/render.js';
import { SolverPage, solverPath } from './SolverPage.js';

const ANSWER: SolverStepsResponse = {
  crossFace: 'D',
  status: 'solved',
  steps: [
    {
      kind: 'cross',
      tokens: ["U'", "R'"],
      explanation: { source: 'template', text: 'Solve the yellow cross in 2 moves.\nIts edges: …' },
    },
    {
      kind: 'pair',
      tokens: ['y', 'R', 'U', "R'"],
      explanation: { source: 'template', text: 'Next, the green–red pair.' },
    },
  ],
};

/** A guest, and the solver's answer. Returns the mock so tests can see what was asked. */
function mockApi(answer: SolverStepsResponse = ANSWER) {
  const fetch = vi.fn((url: string) => {
    if (url.includes('/auth/me')) {
      return Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { code: 'UNAUTHENTICATED', message: 'No' } }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const solverCalls = (fetch: ReturnType<typeof mockApi>) =>
  fetch.mock.calls.map(([url]) => url).filter((url) => url.includes('/solver/steps'));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SolverPage', () => {
  it('shows each step with its moves, move count and explanation', async () => {
    mockApi();
    renderWithProviders(<SolverPage />, { route: solverPath("R U'") });

    expect(await screen.findByRole('heading', { name: 'yellow cross' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pair 1' })).toBeInTheDocument();
    expect(screen.getByText("y R U R'")).toBeInTheDocument();
    // The rotation is shown but not counted.
    expect(screen.getByText('3 moves')).toBeInTheDocument();
    expect(screen.getByText('Solve the yellow cross in 2 moves.')).toBeInTheDocument();
    expect(screen.getByText('Next, the green–red pair.')).toBeInTheDocument();
  });

  it('asks the API for the scramble and cross face in the URL', async () => {
    const fetch = mockApi({ ...ANSWER, crossFace: 'U' });
    renderWithProviders(<SolverPage />, { route: solverPath('R U’', 'U') });

    await screen.findByRole('heading', { name: 'white cross' });
    const url = new URL(solverCalls(fetch)[0] ?? '', 'http://x');
    // Typographic primes are normalised before the request, so the cache key is stable.
    expect(url.searchParams.get('scramble')).toBe("R U'");
    expect(url.searchParams.get('crossFace')).toBe('U');
  });

  it('explains an invalid scramble without asking the API', async () => {
    const fetch = mockApi();
    renderWithProviders(<SolverPage />, { route: solverPath('R y U') });

    expect(await screen.findByRole('alert')).toHaveTextContent("Invalid move 'y'");
    expect(solverCalls(fetch)).toEqual([]);
  });

  it('solves what is typed when the form is submitted', async () => {
    const fetch = mockApi();
    renderWithProviders(<SolverPage />, { route: '/solver' });

    await userEvent.type(screen.getByLabelText('Scramble'), 'F2 D');
    await userEvent.selectOptions(screen.getByLabelText('Cross colour'), 'white');
    await userEvent.click(screen.getByRole('button', { name: 'Solve' }));

    await screen.findByRole('heading', { name: 'Pair 1' });
    const url = new URL(solverCalls(fetch)[0] ?? '', 'http://x');
    expect(url.searchParams.get('scramble')).toBe('F2 D');
    expect(url.searchParams.get('crossFace')).toBe('U');
  });

  it('says so when F2L could not be finished', async () => {
    mockApi({ ...ANSWER, status: 'failed' });
    renderWithProviders(<SolverPage />, { route: solverPath('R') });

    expect(await screen.findByRole('alert')).toHaveTextContent('could not finish');
  });
});
