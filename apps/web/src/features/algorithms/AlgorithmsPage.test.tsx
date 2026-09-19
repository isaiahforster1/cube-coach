import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PLL_CASES } from '@cube-coach/shared';
import { renderWithProviders } from '../../test/render.js';
import { AlgorithmsPage } from './AlgorithmsPage.js';

function mockSession() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ user: null }),
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AlgorithmsPage', () => {
  it('lists every case', () => {
    mockSession();
    renderWithProviders(<AlgorithmsPage />);

    for (const entry of PLL_CASES) {
      expect(screen.getByRole('heading', { name: entry.id, level: 4 })).toBeInTheDocument();
    }
  });

  it('shows the algorithm beside each case', () => {
    mockSession();
    renderWithProviders(<AlgorithmsPage />);

    const t = PLL_CASES.find((entry) => entry.id === 'T');
    expect(screen.getByText(t?.algorithm ?? '')).toBeInTheDocument();
  });

  /**
   * The picture is drawn from the algorithm, so a case must never render as a solved
   * cube — that would mean the algorithm does nothing.
   */
  it('draws a scrambled cube for every case', () => {
    mockSession();
    const { container } = renderWithProviders(<AlgorithmsPage />);

    const cubes = container.querySelectorAll('[role="img"]');
    expect(cubes).toHaveLength(PLL_CASES.length);

    for (const cube of cubes) {
      expect(cube.getAttribute('aria-label')).not.toMatch(/solved cube/iu);
    }
  });

  it('groups the cases by what they move', () => {
    mockSession();
    renderWithProviders(<AlgorithmsPage />);

    expect(screen.getByRole('heading', { name: /edges only/iu })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /corners only/iu })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /corners and edges/iu })).toBeInTheDocument();
  });

  it('filters as you search', async () => {
    mockSession();
    const user = userEvent.setup();
    renderWithProviders(<AlgorithmsPage />);

    await user.type(screen.getByRole('searchbox', { name: /search cases/iu }), 'Ua');

    expect(screen.getByRole('heading', { name: 'Ua', level: 4 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'T', level: 4 })).not.toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    mockSession();
    const user = userEvent.setup();
    renderWithProviders(<AlgorithmsPage />);

    await user.type(screen.getByRole('searchbox', { name: /search cases/iu }), 'zzzz');

    expect(screen.getByText(/no case matches/iu)).toBeInTheDocument();
  });

  /** The player is mounted only on request: 21 animation loops would be absurd. */
  it('keeps the player out of the way until a case is opened', async () => {
    mockSession();
    const user = userEvent.setup();
    renderWithProviders(<AlgorithmsPage />);

    expect(screen.queryByRole('button', { name: /play the algorithm/iu })).not.toBeInTheDocument();

    const cards = screen.getAllByRole('button', { name: /watch it/iu });
    await user.click(cards[0] as HTMLElement);

    expect(screen.getByRole('button', { name: /play the algorithm/iu })).toBeInTheDocument();
  });

  it('plays the algorithm from the case rather than from a solved cube', async () => {
    mockSession();
    const user = userEvent.setup();
    renderWithProviders(<AlgorithmsPage />);

    await user.click(screen.getAllByRole('button', { name: /watch it/iu })[0] as HTMLElement);

    // Nothing applied yet, so the player still shows the case it is about to solve.
    expect(screen.getByRole('status')).toHaveTextContent('0 /');
    expect(screen.getByRole('button', { name: /previous move/iu })).toBeDisabled();
  });

  /** Two of the algorithms were found by search, and the page says which. */
  it('credits the algorithms that were not written from memory', () => {
    mockSession();
    renderWithProviders(<AlgorithmsPage />);

    const searched = PLL_CASES.filter((entry) => entry.source !== undefined);
    expect(searched.length).toBeGreaterThan(0);

    for (const entry of searched) {
      const card = screen.getByRole('heading', { name: entry.id, level: 4 }).closest('article');
      expect(within(card as HTMLElement).getByText(/found by search/iu)).toBeInTheDocument();
    }
  });
});
