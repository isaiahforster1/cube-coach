import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InfoTip } from './InfoTip.js';

function renderTip() {
  return render(<InfoTip term="ao5">Average of five, dropping the best and worst.</InfoTip>);
}

describe('InfoTip', () => {
  it('is hidden until asked for', () => {
    renderTip();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('names the term it explains, for screen readers', () => {
    renderTip();
    expect(screen.getByRole('button', { name: 'What is ao5?' })).toBeInTheDocument();
  });

  it('opens on hover', async () => {
    const user = userEvent.setup();
    renderTip();

    await user.hover(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Average of five');
  });

  it('closes again when the pointer leaves', async () => {
    const user = userEvent.setup();
    renderTip();

    await user.hover(screen.getByRole('button'));
    await user.unhover(screen.getByRole('button'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  /**
   * The reason this is a button rather than a `title` attribute: `title` never appears
   * for a keyboard user, and never appears on a touch screen.
   */
  it('opens on keyboard focus', async () => {
    const user = userEvent.setup();
    renderTip();

    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('opens on tap, for touch screens where there is no hover', async () => {
    const user = userEvent.setup();
    renderTip();

    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('links the explanation to the control with aria-describedby', async () => {
    const user = userEvent.setup();
    renderTip();

    await user.click(screen.getByRole('button'));

    const described = screen.getByRole('button').getAttribute('aria-describedby');
    expect(described).not.toBeNull();
    expect(screen.getByRole('tooltip')).toHaveAttribute('id', described);
  });

  it('reports whether it is open', async () => {
    const user = userEvent.setup();
    renderTip();

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderTip();

    await user.click(screen.getByRole('button'));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

/**
 * The scramble's marker sits near the top of the page, and a tip anchored above it ran
 * off the top of the window and lost its first line.
 *
 * The decision is made by measuring rather than by a distance threshold, because the
 * tip's height depends on how long the explanation is — a rule like "flip if within
 * 150px of the top" would be right for one tip and wrong for the next.
 */
describe('InfoTip placement', () => {
  /** Pretend every element sits at a given distance from the top of the window. */
  function pinTopTo(top: number): () => void {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function fake(this: Element): DOMRect {
      return { ...original.call(this), top } as DOMRect;
    };
    return () => {
      Element.prototype.getBoundingClientRect = original;
    };
  }

  function placementOf(container: HTMLElement): string | null {
    return container.querySelector('[data-placement]')?.getAttribute('data-placement') ?? null;
  }

  it('sits above the marker when there is room', async () => {
    const restore = pinTopTo(400);
    try {
      const user = userEvent.setup();
      const { container } = renderTip();

      await user.hover(screen.getByRole('button'));
      expect(placementOf(container)).toBe('above');
    } finally {
      restore();
    }
  });

  it('flips below the marker when it would run off the top', async () => {
    const restore = pinTopTo(-30);
    try {
      const user = userEvent.setup();
      const { container } = renderTip();

      await user.hover(screen.getByRole('button'));
      expect(placementOf(container)).toBe('below');
    } finally {
      restore();
    }
  });

  /** The marker may have moved by the next time it opens, so the choice is remade. */
  it('measures again each time it opens', async () => {
    const user = userEvent.setup();

    const tight = pinTopTo(-30);
    const { container } = renderTip();
    await user.hover(screen.getByRole('button'));
    expect(placementOf(container)).toBe('below');

    await user.unhover(screen.getByRole('button'));
    tight();

    const roomy = pinTopTo(400);
    try {
      await user.hover(screen.getByRole('button'));
      expect(placementOf(container)).toBe('above');
    } finally {
      roomy();
    }
  });
});
