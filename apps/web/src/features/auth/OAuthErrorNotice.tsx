import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Explains a failed Google sign-in.
 *
 * The callback redirects back here with a marker rather than rendering an error page,
 * because the browser is mid-navigation at that point and a raw JSON body would be shown
 * to the user as-is.
 */
const MESSAGES: Record<string, string> = {
  google_state:
    'That sign-in link had expired or did not match. Please try signing in with Google again.',
  google_failed: 'Google sign-in did not complete. You can try again, or use a password.',
};

export function OAuthErrorNotice(): ReactElement | null {
  const [params] = useSearchParams();
  const error = params.get('error');

  if (error === null) return null;

  return (
    <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {MESSAGES[error] ?? 'Sign-in did not complete. Please try again.'}
    </p>
  );
}
