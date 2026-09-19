import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseAlgorithm, type Scramble } from '@cube-coach/shared';
import { ScrambleView } from './ScrambleView.js';

function scrambleOf(notation: string, quality: Scramble['quality'] = 'random-state'): Scramble {
  return { moves: parseAlgorithm(notation), notation, quality };
}

beforeEach(() => {
  localStorage.clear();
});

describe('ScrambleView', () => {
  it('shows the scramble', () => {
    render(<ScrambleView scramble={scrambleOf("R U R' U'")} />);
    expect(screen.getByText("R U R' U'")).toBeInTheDocument();
  });

  it('says so while a scramble is still being generated', () => {
    render(<ScrambleView scramble={null} />);
    expect(screen.getByText(/generating scramble/iu)).toBeInTheDocument();
  });

  /**
   * The cube is opt-in. Someone who reads notation fluently should not have to scroll
   * past a cube they did not ask for to reach the timer.
   */
  it('keeps the cube out of the way until it is asked for', () => {
    render(<ScrambleView scramble={scrambleOf('R U')} />);

    expect(screen.getByRole('button', { name: /show me this scramble/iu })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows the cube when asked', async () => {
    const user = userEvent.setup();
    render(<ScrambleView scramble={scrambleOf('R U')} />);

    await user.click(screen.getByRole('button', { name: /show me this scramble/iu }));

    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide cube/iu })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('offers play, step and reset controls, each with a name', async () => {
    const user = userEvent.setup();
    render(<ScrambleView scramble={scrambleOf('R U')} />);
    await user.click(screen.getByRole('button', { name: /show me this scramble/iu }));

    expect(screen.getByRole('button', { name: /play the scramble/iu })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next move/iu })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous move/iu })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to solved/iu })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /speed/iu })).toBeInTheDocument();
  });

  it('starts at the beginning of the scramble', async () => {
    const user = userEvent.setup();
    render(<ScrambleView scramble={scrambleOf("R U F'")} />);
    await user.click(screen.getByRole('button', { name: /show me this scramble/iu }));

    expect(screen.getByRole('status')).toHaveTextContent('0 / 3');
    expect(screen.getByRole('button', { name: /previous move/iu })).toBeDisabled();
  });

  it('advances a move at a time', async () => {
    // Fastest setting, so the test waits milliseconds rather than seconds.
    localStorage.setItem('cube-coach.scramble-speed', '6');

    const user = userEvent.setup();
    render(<ScrambleView scramble={scrambleOf("R U F'")} />);
    await user.click(screen.getByRole('button', { name: /show me this scramble/iu }));
    await user.click(screen.getByRole('button', { name: /next move/iu }));

    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
  });

  /**
   * Re-deciding this on every visit would be its own small annoyance, and it is exactly
   * the kind of preference that does not need an account.
   */
  it('remembers that the cube was opened', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ScrambleView scramble={scrambleOf('R U')} />);

    await user.click(screen.getByRole('button', { name: /show me this scramble/iu }));
    unmount();

    render(<ScrambleView scramble={scrambleOf('R U')} />);
    expect(screen.getByRole('button', { name: /hide cube/iu })).toBeInTheDocument();
  });

  it('renders without storage, rather than failing', () => {
    // Private browsing and blocked site data both surface as a throw, not as null.
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('Access denied');
      },
    });

    try {
      render(<ScrambleView scramble={scrambleOf('R U')} />);
      expect(screen.getByText('R U')).toBeInTheDocument();
    } finally {
      if (original !== undefined) Object.defineProperty(window, 'localStorage', original);
    }
  });
});

describe('scramble difficulty label', () => {
  it('rates a scramble that leaves the cross alone as easy', async () => {
    // U does not touch a single D-cross piece, so the cross is already solved.
    render(<ScrambleView scramble={scrambleOf('U')} />);

    expect(await screen.findByText('Easy')).toBeInTheDocument();
  });

  it('explains what the rating actually measured', async () => {
    const user = userEvent.setup();
    render(<ScrambleView scramble={scrambleOf('U')} />);
    await screen.findByText('Easy');

    await user.click(screen.getByRole('button', { name: /what is the scramble difficulty/iu }));

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent(/cross/iu);
    expect(tooltip).toHaveTextContent(/0 moves/iu);
  });

  it('labels every scramble with exactly one rating', async () => {
    render(<ScrambleView scramble={scrambleOf("R U R' U' F2 L D B'")} />);

    const rating = await screen.findByText(/^(Easy|Standard|Hard)$/u);
    expect(rating).toBeInTheDocument();
  });

  it('shows no rating while there is no scramble', () => {
    const { container } = render(<ScrambleView scramble={null} />);
    expect(within(container).queryByText(/^(Easy|Standard|Hard)$/u)).not.toBeInTheDocument();
  });
});

/**
 * The solver that produces competition-quality scrambles runs in a worker, and a worker
 * is not something a web page is guaranteed to get. When it cannot start, the timer
 * falls back to random turns — which are fine to practise on and are not the same thing,
 * so the difference is stated rather than hidden.
 */
describe('scramble quality', () => {
  it('says nothing when the scrambles are the proper kind', () => {
    render(<ScrambleView scramble={scrambleOf('R U', 'random-state')} />);

    expect(screen.queryByText(/practice scramble/iu)).not.toBeInTheDocument();
  });

  it('marks a fallback scramble as a practice one', () => {
    render(<ScrambleView scramble={scrambleOf('R U', 'random-move')} />);

    expect(screen.getByText(/practice scramble/iu)).toBeInTheDocument();
  });

  it('explains what a practice scramble is rather than just labelling it', async () => {
    const user = userEvent.setup();
    render(<ScrambleView scramble={scrambleOf('R U', 'random-move')} />);

    await user.click(screen.getByRole('button', { name: /what is a practice scramble/iu }));

    expect(screen.getByRole('tooltip')).toHaveTextContent(/some positions come up more often/iu);
  });
});
