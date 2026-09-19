import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimerDisplay } from './TimerDisplay.js';

function renderDisplay(props: Partial<Parameters<typeof TimerDisplay>[0]> = {}) {
  return render(
    <TimerDisplay
      phase="idle"
      displayMs={0}
      penalty="none"
      inspectionRemainingMs={undefined}
      {...props}
    />,
  );
}

describe('TimerDisplay without inspection', () => {
  it('shows zero before a solve', () => {
    const { container } = renderDisplay();
    expect(container.textContent).toContain('0.00');
  });

  it('shows the running time', () => {
    const { container } = renderDisplay({ phase: 'running', displayMs: 12_340 });
    expect(container.textContent).toContain('12.34');
  });

  it('shows the penalised time once stopped', () => {
    const { container } = renderDisplay({ phase: 'stopped', displayMs: 12_340, penalty: 'plus2' });
    expect(container.textContent).toContain('14.34+');
  });

  it('announces the finished solve once, for screen readers', () => {
    renderDisplay({ phase: 'stopped', displayMs: 12_340, penalty: 'none' });
    expect(screen.getByText(/solve finished: 12\.34/iu)).toBeInTheDocument();
  });
});

describe('TimerDisplay during inspection', () => {
  it('counts down in whole seconds', () => {
    const { container } = renderDisplay({ phase: 'inspecting', inspectionRemainingMs: 12_400 });
    expect(container.textContent).toContain('13');
  });

  /**
   * The bug this covers: `ready` used to fall through to the solve time, so the countdown
   * was replaced by `0.00` at the moment the cuber most needs it — and a zero there reads
   * as a running timer rather than as an absence.
   */
  it('keeps showing the countdown while the timer is being armed', () => {
    const holding = renderDisplay({ phase: 'holding', inspectionRemainingMs: 9_100 });
    expect(holding.container.textContent).toContain('10');
    holding.unmount();

    const ready = renderDisplay({ phase: 'ready', inspectionRemainingMs: 9_100 });
    expect(ready.container.textContent).toContain('10');
    expect(ready.container.textContent).not.toContain('0.00');
  });

  it('warns that the solve will carry a +2 once inspection overruns', () => {
    const { container } = renderDisplay({ phase: 'inspecting', inspectionRemainingMs: -500 });
    expect(container.textContent).toContain('+2');
  });

  it('warns of a DNF past the grace band', () => {
    const { container } = renderDisplay({ phase: 'inspecting', inspectionRemainingMs: -2_500 });
    expect(container.textContent).toContain('DNF');
  });

  it('switches to the solve time once running', () => {
    const { container } = renderDisplay({
      phase: 'running',
      displayMs: 3_210,
      inspectionRemainingMs: undefined,
    });
    expect(container.textContent).toContain('3.21');
  });
});
