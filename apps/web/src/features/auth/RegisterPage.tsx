import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, Navigate } from 'react-router';
import { registerRequestSchema } from '@cube-coach/shared';
import { ApiError } from '../../lib/api-client.js';
import { fieldErrors } from '../../lib/form-errors.js';
import { TextField } from '../../components/TextField.js';
import { useRegister, useSession } from './use-session.js';

export function RegisterPage(): ReactElement {
  const { data: user } = useSession();
  const register = useRegister();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (user !== null && user !== undefined) {
    return <Navigate to="/" replace />;
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();

    const result = registerRequestSchema.safeParse({ displayName, email, password });

    if (!result.success) {
      setErrors(fieldErrors(result.error));
      return;
    }

    setErrors({});
    register.mutate(result.data);
  }

  const failure = register.error;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-2xl font-semibold text-slate-900">Create an account</h1>
      <p className="mb-6 text-sm text-slate-500">Start tracking your solves.</p>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          id="displayName"
          label="Display name"
          autoComplete="nickname"
          value={displayName}
          onChange={setDisplayName}
          error={errors['displayName']}
        />

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
          // Tells a password manager to offer a generated password rather than
          // autofilling an existing one.
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={errors['password']}
        />

        <p className="-mt-1 text-xs text-slate-500">At least 10 characters.</p>

        {failure !== null && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {failure instanceof ApiError ? failure.message : 'Could not create your account'}
          </p>
        )}

        <button
          type="submit"
          disabled={register.isPending}
          className="mt-2 rounded-md bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 focus:ring-2 focus:ring-sky-300 disabled:opacity-60"
        >
          {register.isPending ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-sky-700 underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
