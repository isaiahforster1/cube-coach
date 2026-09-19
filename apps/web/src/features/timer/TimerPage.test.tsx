import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render.js';
import { TimerPage } from './TimerPage.js';

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ user: { id: '1', email: 'a@b', displayName: 'C', createdAt: '' } }),
        });
      }
      if (url.includes('/practice-sessions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              practiceSessions: [
                {
                  id: '00000000-0000-4000-8000-000000000001',
                  name: 'Main',
                  createdAt: '',
                  archivedAt: null,
                },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TimerPage inspection toggle', () => {
  /**
   * The bug this exists for, reported from actual use: clicking the checkbox gives it
   * keyboard focus, so the next spacebar press toggles the checkbox instead of starting
   * the timer. The setting flickers on and off and no countdown ever appears.
   */
  it('does not keep toggling the checkbox when space is pressed after enabling it', async () => {
    mockApi();
    const user = userEvent.setup();
    renderWithProviders(<TimerPage />);

    const checkbox = await screen.findByLabelText('Inspection');
    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    // The very next thing a cuber does is press space.
    await user.keyboard(' ');

    expect(checkbox).toBeChecked();
  });

  it('gives the spacebar back to the timer after the setting is changed', async () => {
    mockApi();
    const user = userEvent.setup();
    renderWithProviders(<TimerPage />);

    const checkbox = await screen.findByLabelText('Inspection');
    await user.click(checkbox);

    // Focus must not be left on the checkbox, or it swallows every space press.
    expect(document.activeElement).not.toBe(checkbox);
  });

  it('starts the inspection countdown when space is pressed', async () => {
    mockApi();
    const user = userEvent.setup();
    renderWithProviders(<TimerPage />);

    const checkbox = await screen.findByLabelText('Inspection');
    await user.click(checkbox);
    // userEvent syntax: braces name a key, brackets name a code. The handler checks
    // event.code, so this has to be the bracket form.
    await user.keyboard('[Space>]');

    // 15 seconds, counting down, rather than a stopwatch reading zero.
    await waitFor(() => {
      expect(screen.getByText('15')).toBeInTheDocument();
    });
    await user.keyboard('[/Space]');
  });

  it('shows the instruction for the mode that is actually enabled', async () => {
    mockApi();
    const user = userEvent.setup();
    renderWithProviders(<TimerPage />);

    expect(await screen.findByText(/hold space, release to start/iu)).toBeInTheDocument();

    await user.click(screen.getByLabelText('Inspection'));
    expect(screen.getByText(/press space to begin inspection/iu)).toBeInTheDocument();
  });
});
