import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router';
import { LoginPage } from './features/auth/LoginPage.js';
import { ProtectedRoute } from './features/auth/ProtectedRoute.js';
import { RegisterPage } from './features/auth/RegisterPage.js';
import { HistoryPage } from './features/history/HistoryPage.js';
import { TimerPage } from './features/timer/TimerPage.js';

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Everything nested here requires a signed-in user. */}
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<TimerPage />} />
        <Route path="/history" element={<HistoryPage />} />
      </Route>

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
