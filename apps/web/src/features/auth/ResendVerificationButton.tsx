import type { ReactElement } from 'react';
import { ApiError } from '../../lib/api-client.js';
import { useResendVerification } from './use-email-verification.js';

/**
 * Ask for another confirmation link, and say what happened.
 *
 * The outcome is announced (role="status" or "alert") because the button itself does not
 * change, and a click that visibly does nothing to a screen reader user seems broken.
 */
export function ResendVerificationButton({ className = '' }: { className?: string }): ReactElement {
  const resend = useResendVerification();

  if (resend.isSuccess) {
    return (
      <p role="status" className={`text-sm text-slate-600 ${className}`}>
        A new link is on its way. Check your inbox.
      </p>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => resend.mutate()}
        disabled={resend.isPending}
        className="text-sm font-medium text-sky-700 underline disabled:opacity-60"
      >
        {resend.isPending ? 'Sending…' : 'Send a new link'}
      </button>
      {resend.error !== null && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {resend.error instanceof ApiError ? resend.error.message : 'Could not send the link'}
        </p>
      )}
    </div>
  );
}
