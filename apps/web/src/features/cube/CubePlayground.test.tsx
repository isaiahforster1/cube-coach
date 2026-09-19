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

/**
 * Moves are animated rather than snapped, because watching a layer turn is how someone
 * who does not read notation learns what a move does. The timeline itself is covered in
 * `use-turn-animation.test.ts`; these check the page drives it.
 */
describe('CubePlayground animation', () => {
  function turningLayer(container: HTMLElement) {
    return container.querySelector('[data-testid="turning-layer"]');
  }

  it('turns the layer rather than jumping to the new position', async () => {
    mockSession();
    const user = userEvent.setup();
    const { container } = renderWithProviders(<CubePlayground />);

    await user.click(screen.getByRole('button', { name: 'R' }));

    expect(turningLayer(container)).toHaveAttribute('data-move', 'R');
  });

  /** Undo plays the move backwards, so you can see which layer is being given back. */
  it('runs the move in reverse when undoing', async () => {
    mockSession();
    const user = userEvent.setup();
    const { container } = renderWithProviders(<CubePlayground />);

    await user.click(screen.getByRole('button', { name: "F'" }));
    await screen.findByText('1 move applied');

    await user.click(screen.getByRole('button', { name: /^Undo/u }));

    // The same move, not its inverse: it is drawn fully turned and then unwound.
    expect(turningLayer(container)).toHaveAttribute('data-move', "F'");
    expect(screen.getByText('Solved')).toBeInTheDocument();
  });

  /**
   * Pressing buttons faster than the animation must not lose moves. A turn still in the
   * air counts as done, so the next press builds on it.
   */
  it('keeps every move when they are pressed faster than they animate', async () => {
    mockSession();
    const user = userEvent.setup();
    renderWithProviders(<CubePlayground />);

    await user.click(screen.getByRole('button', { name: 'R' }));
    await user.click(screen.getByRole('button', { name: 'U' }));
    await user.click(screen.getByRole('button', { name: "R'" }));
    await user.click(screen.getByRole('button', { name: "U'" }));

    expect(screen.getByText("R U R' U'")).toBeInTheDocument();
    expect(screen.getByText('4 moves applied')).toBeInTheDocument();
  });

  it('stops turning when reset', async () => {
    mockSession();
    const user = userEvent.setup();
    const { container } = renderWithProviders(<CubePlayground />);

    await user.click(screen.getByRole('button', { name: 'R' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(turningLayer(container)).toBeNull();
    expect(screen.getByText('Solved')).toBeInTheDocument();
  });
});
