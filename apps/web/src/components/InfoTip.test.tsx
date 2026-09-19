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
