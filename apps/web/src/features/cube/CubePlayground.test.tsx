import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render.js';
import { CubePlayground } from './CubePlayground.js';

function mockSession() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            user: { id: '1', email: 'a@b', displayName: 'C', createdAt: '' },
          }),
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CubePlayground', () => {
  it('starts from a solved cube', () => {
    mockSession();
    renderWithProviders(<CubePlayground />);

    expect(screen.getByRole('img', { name: /solved cube/iu })).toBeInTheDocument();
    expect(screen.getByText('Solved')).toBeInTheDocument();
  });

  it('applies a move when its button is pressed', async () => {
    mockSession();
    const user = userEvent.setup();
    renderWithProviders(<CubePlayground />);

    await user.click(screen.getByRole('button', { name: 'R' }));

    expect(screen.getByRole('img', { name: /scrambled cube/iu })).toBeInTheDocument();
    expect(screen.getByText('1 move applied')).toBeInTheDocument();
  });

  it('records the moves applied as an algorithm', async () => {
    mockSession();
    const user = userEvent.setup();
    renderWithProviders(<CubePlayground />);

    await user.click(screen.getByRole('button', { name: 'R' }));
    await user.click(screen.getByRole('button', { name: 'U2' }));

    expect(screen.getByText('R U2')).toBeInTheDocument();
  });

  /**
   * The cube position is derived from the move list rather than stored alongside it, so
   * undo is simply dropping the last move and the two can never disagree.
   */
  it('undoes the last move', async () => {
    mockSession();
    const user = userEvent.setup();
    renderWithProviders(<CubePlayground />);

    await user.click(screen.getByRole('button', { name: 'R' }));
    await user.click(screen.getByRole('button', { name: /^Undo/u }));

    expect(screen.getByText('Solved')).toBeInTheDocument();
  });

  it('names the move that undo will apply', async () => {
    mockSession();
    const user = userEvent.setup();
    renderWithProviders(<CubePlayground />);

    await user.click(screen.getByRole('button', { name: 'R' }));
    expect(screen.getByRole('button', { name: "Undo R'" })).toBeInTheDocument();
  });

  it('cannot undo or reset from a solved start', () => {
    mockSession();
    renderWithProviders(<CubePlayground />);

    expect(screen.getByRole('button', { name: /^Undo/u })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
  });

  it('returns to solved when reset', async () => {
    mockSession();
    const user = userEvent.setup();
    renderWithProviders(<CubePlayground />);

    await user.click(screen.getByRole('button', { name: 'R' }));
    await user.click(screen.getByRole('button', { name: 'F2' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByRole('img', { name: /solved cube/iu })).toBeInTheDocument();
  });

  /** A move and its inverse must cancel, which is the engine's own property showing through. */
  it('returns to solved when a move is followed by its inverse', async () => {
    mockSession();
    const user = userEvent.setup();
    renderWithProviders(<CubePlayground />);

    await user.click(screen.getByRole('button', { name: 'R' }));
    await user.click(screen.getByRole('button', { name: "R'" }));

    expect(screen.getByText('Solved')).toBeInTheDocument();
  });

  it('offers every legal move', () => {
    mockSession();
    renderWithProviders(<CubePlayground />);

    // Six faces, three turns each.
    for (const move of ['U', "U'", 'U2', 'R', "R'", 'R2', 'B2', "L'", 'D', 'F2']) {
      expect(screen.getByRole('button', { name: move })).toBeInTheDocument();
    }
  });
});
