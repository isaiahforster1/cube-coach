import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router';
import { AlgorithmsPage } from './features/algorithms/AlgorithmsPage.js';
import { LoginPage } from './features/auth/LoginPage.js';
import { RegisterPage } from './features/auth/RegisterPage.js';
import { CubePlayground } from './features/cube/CubePlayground.js';
import { HistoryPage } from './features/history/HistoryPage.js';
import { StatsPage } from './features/stats/StatsPage.js';
import { TimerPage } from './features/timer/TimerPage.js';

/**
 * Every feature is reachable without an account.
 *
 * There is no protected route any more. A guest's solves are kept in their browser and
 * everything — timer, history, statistics, cube — works exactly as it does for a
 * signed-in user, because both go through the same store interface. Signing in is an
 * upgrade rather than a gate, and it carries the guest's solves with it.
 */
export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<TimerPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/stats" element={<StatsPage />} />
      <Route path="/cube" element={<CubePlayground />} />
      <Route path="/algorithms" element={<AlgorithmsPage />} />

      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route
        path="*"
        element={
          <main className="flex min-h-screen items-center justify-center text-slate-500">
            <h1>Page not found</h1>
          </main>
        }
      />
    </Routes>
  );
}
