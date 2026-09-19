import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { loginRequestSchema } from '@cube-coach/shared';
import { ApiError } from '../../lib/api-client.js';
import { fieldErrors } from '../../lib/form-errors.js';
import { TextField } from '../../components/TextField.js';
import { GoogleSignInButton } from './GoogleSignInButton.js';
import { OAuthErrorNotice } from './OAuthErrorNotice.js';
import { useLogin, useSession } from './use-session.js';

export function LoginPage(): ReactElement {
  const { data: user } = useSession();
  const location = useLocation();
  const login = useLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (user !== null && user !== undefined) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? '/'} replace />;
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();

    // Validated with the same schema the server uses, from packages/shared. This is
    // convenience, not security: it saves a round trip for an obvious mistake. The
    // server validates independently, because anything sent from a browser can be
    // forged.
    const result = loginRequestSchema.safeParse({ email, password });

    if (!result.success) {
      setErrors(fieldErrors(result.error));
      return;
    }

    setErrors({});
    login.mutate(result.data);
  }

  const failure = login.error;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-2xl font-semibold text-slate-900">Sign in</h1>
      <p className="mb-6 text-sm text-slate-500">
        Your solves are saved to your account and follow you between devices.
      </p>

      <OAuthErrorNotice />

      <div className="mb-5 flex flex-col gap-4">
        <GoogleSignInButton />
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={errors['email']}
        />

        <TextField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={errors['password']}
        />

        {failure !== null && (
          // role="alert" makes a screen reader announce this the moment it appears.
          // Without it the message is silent to anyone not looking at that part of the
          // page, and a failed sign-in just seems to do nothing.
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {failure instanceof ApiError ? failure.message : 'Could not sign in'}
          </p>
        )}

        <button
          type="submit"
          disabled={login.isPending}
          className="mt-2 rounded-md bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 focus:ring-2 focus:ring-sky-300 disabled:opacity-60"
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-400">
        {/*
          A way back out. Someone who followed the sign-in link and changed their mind
          should not have to use the browser's back button to escape — the account is
          optional, and the page should behave as though it means it.
        */}
        <Link to="/" className="underline-offset-4 hover:text-slate-700 hover:underline">
          Continue without an account
        </Link>
      </p>

      <p className="mt-6 text-sm text-slate-600">
        No account?{' '}
        <Link to="/register" className="font-medium text-sky-700 underline">
          Create one
        </Link>
      </p>
    </main>
  );
}
