import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Collapse } from './Collapse.js';

/**
 * Give the content a height. Nothing is laid out in a test DOM, so `scrollHeight` is
 * zero and the component would have nothing to measure.
 */
function stubContentHeight(panel: HTMLElement, height: number): void {
  const content = panel.firstElementChild as HTMLElement;
  Object.defineProperty(content, 'scrollHeight', { configurable: true, value: height });
}

describe('Collapse', () => {
  it('renders nothing while closed', () => {
    render(
      <Collapse open={false}>
        <p>Inside</p>
      </Collapse>,
    );

    expect(screen.queryByText('Inside')).not.toBeInTheDocument();
  });

  it('shows its contents when open', () => {
    render(
      <Collapse open>
        <p>Inside</p>
      </Collapse>,
    );

    expect(screen.getByText('Inside')).toBeInTheDocument();
  });

  /**
   * A remembered preference must not replay an animation on every page load, so a panel
   * that starts open simply is open.
   */
  it('settles straight into its resting height when it has not been toggled', () => {
    const { container } = render(
      <Collapse open>
        <p>Inside</p>
      </Collapse>,
    );

    expect((container.firstElementChild as HTMLElement).style.height).toBe('auto');
  });

  it('rests at no height when closed', () => {
    const { container } = render(
      <Collapse open={false}>
        <p>Inside</p>
      </Collapse>,
    );

    expect((container.firstElementChild as HTMLElement).style.height).toBe('0px');
  });

  /**
   * The height is animated between two numbers, so anything that no longer fits has to
   * be clipped rather than spilling out of the panel.
   */
  it('clips whatever does not fit the height it is animating', () => {
    const { container } = render(
      <Collapse open>
        <p>Inside</p>
      </Collapse>,
    );

    expect(container.firstElementChild).toHaveClass('overflow-hidden');
  });

  /**
   * The subtle part, and the reason this has a test at all.
   *
   * Two style changes in the same task are collapsed into one, so setting only the
   * destination height leaves the browser with nothing to transition from and the panel
   * jumps. Reading a layout property in between forces the first value to be resolved.
   *
   * That read looks exactly like a line with no effect, which is precisely the sort of
   * thing a tidy-up deletes. This fails if it goes.
   */
  it('forces the starting height to be resolved before animating away from it', async () => {
    const { container, rerender } = render(
      <Collapse open={false}>
        <p>Inside</p>
      </Collapse>,
    );
    const panel = container.firstElementChild as HTMLElement;
    stubContentHeight(panel, 120);

    const heightsWhenRead: string[] = [];
    Object.defineProperty(panel, 'offsetHeight', {
      configurable: true,
      get() {
        heightsWhenRead.push(panel.style.height);
        return 0;
      },
    });

    rerender(
      <Collapse open>
        <p>Inside</p>
      </Collapse>,
    );

    await waitFor(() => expect(panel.style.height).toBe('120px'));

    // Layout was read while the panel still held its starting height.
    expect(heightsWhenRead).toContain('0px');
  });

  it('measures the content rather than guessing a height', async () => {
    const { container, rerender } = render(
      <Collapse open={false}>
        <p>Inside</p>
      </Collapse>,
    );
    const panel = container.firstElementChild as HTMLElement;
    stubContentHeight(panel, 87);

    rerender(
      <Collapse open>
        <p>Inside</p>
      </Collapse>,
    );

    await waitFor(() => expect(panel.style.height).toBe('87px'));
  });

  /**
   * Leaving a pixel height behind would freeze the panel at whatever size it was when it
   * opened, clipping anything that reflowed afterwards.
   */
  it('hands the height back to the content once it has finished opening', async () => {
    const { container, rerender } = render(
      <Collapse open={false} durationMs={20}>
        <p>Inside</p>
      </Collapse>,
    );
    const panel = container.firstElementChild as HTMLElement;
    stubContentHeight(panel, 120);

    rerender(
      <Collapse open durationMs={20}>
        <p>Inside</p>
      </Collapse>,
    );

    await waitFor(() => expect(panel.style.height).toBe('auto'));
  });

  /**
   * Unmounting on close would make the panel vanish and leave an empty box to shrink,
   * which is the thing that looks abrupt.
   */
  it('keeps its contents until the collapse has finished', async () => {
    const { rerender } = render(
      <Collapse open durationMs={40}>
        <p>Inside</p>
      </Collapse>,
    );

    rerender(
      <Collapse open={false} durationMs={40}>
        <p>Inside</p>
      </Collapse>,
    );

    // Still there, shrinking.
    expect(screen.getByText('Inside')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText('Inside')).not.toBeInTheDocument();
    });
  });

  /**
   * While it is closing, the panel is still on screen. Anything inside it must not be
   * focusable or announced, or a keyboard user can tab into a panel they just closed.
   */
  it('makes a closed panel unreachable', () => {
    const { container, rerender } = render(
      <Collapse open>
        <button type="button">Inside</button>
      </Collapse>,
    );
    const panel = container.firstElementChild;

    expect(panel).not.toHaveAttribute('inert');

    rerender(
      <Collapse open={false}>
        <button type="button">Inside</button>
      </Collapse>,
    );
    expect(panel).toHaveAttribute('inert');
  });

  it('takes an id so a trigger can point at it', () => {
    const { container } = render(
      <Collapse open id="panel-1">
        <p>Inside</p>
      </Collapse>,
    );

    expect(container.firstElementChild).toHaveAttribute('id', 'panel-1');
  });
});
