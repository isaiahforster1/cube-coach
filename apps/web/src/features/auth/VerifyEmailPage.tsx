import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../../lib/api-client.js';
import { ResendVerificationButton } from './ResendVerificationButton.js';
import { useVerifyEmail } from './use-email-verification.js';
import { useSession } from './use-session.js';

/**
 * Where the link in a verification email lands.
 *
 * The token arrives in the URL fragment, which the browser never sends to a server, so it
 * stays out of every log on the way here. The page reads it, removes it from the address
 * bar, and posts it. Verifying on a plain GET would let a mail scanner that previews links
 * use the token up before the person ever clicked.
 *
 * The server also needs the session, so a signed-out visitor is sent to sign in first and
 * brought back here with the token afterwards.
 */
export function VerifyEmailPage(): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState(() => readToken(location.hash));

  // Read the token, then take it out of the address bar and the history entry: it is a
  // credential until used. This runs again when a newer link is opened in this same tab,
  // which changes only the fragment and so does not reload the page.
  useEffect(() => {
    if (location.hash === '') return;
    setToken(readToken(location.hash));
    void navigate(location.pathname, { replace: true });
  }, [location.hash, location.pathname, navigate]);

  // Keyed on the token, so a newer one starts a fresh attempt instead of inheriting the
  // last one's result.
  return <ConfirmWithToken key={token ?? ''} token={token} />;
}

function readToken(hash: string): string | null {
  return new URLSearchParams(hash.slice(1)).get('token');
}

function ConfirmWithToken({ token }: { token: string | null }): ReactElement {
  const { data: user, isPending: sessionPending } = useSession();
  const verify = useVerifyEmail();
  const { mutate } = verify;
  const sent = useRef(false);

  // Once, and only when there is something to confirm. The ref keeps React's development
  // double-run of effects from sending a single-use token twice.
  useEffect(() => {
    if (token === null || user === null || user === undefined || user.emailVerified) return;
    if (sent.current) return;
    sent.current = true;
    mutate(token);
  }, [token, user, mutate]);

  if (token === null) {
    return (
      <Shell>
        <p className="text-slate-600">
          This link is incomplete. Open it again from the email, or ask for a new one from the
          Account menu.
        </p>
      </Shell>
    );
  }

  if (sessionPending) {
    return <Shell>{null}</Shell>;
  }

  if (user === null || user === undefined) {
    return (
      <Shell>
        <p className="mb-6 text-slate-600">
          Sign in to finish confirming your email address. You'll come straight back here.
        </p>
        <Link
          to="/login"
          state={{ from: `/verify-email#token=${token}` }}
          className="rounded-md bg-sky-600 px-4 py-2 text-center font-medium text-white hover:bg-sky-700"
        >
          Sign in to confirm
        </Link>
      </Shell>
    );
  }

  if (user.emailVerified) {
    return (
      <Shell>
        <p className="mb-6 text-slate-600">Your email address is confirmed.</p>
        <Link to="/" className="font-medium text-sky-700 underline">
          Back to the timer
        </Link>
      </Shell>
    );
  }

  if (verify.error !== null) {
    return (
      <Shell>
        <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {verify.error instanceof ApiError
            ? verify.error.message
            : 'Could not confirm your email address'}
        </p>
        <ResendVerificationButton />
      </Shell>
    );
  }

  return (
    <Shell>
      <p role="status" className="text-slate-600">
        Confirming…
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }): ReactElement {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6">
      <h1 className="mb-4 text-2xl font-semibold text-slate-900">Confirm your email</h1>
      {children}
    </main>
  );
}
