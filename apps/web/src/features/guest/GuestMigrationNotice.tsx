import { useEffect, useState, type ReactElement } from 'react';
import { useGuestMigration } from './use-guest-migration.js';

/**
 * Tells a new account holder that the solves they recorded as a guest came with them.
 *
 * Brief and self-dismissing: it is reassurance, not an announcement worth interrupting
 * anyone for.
 */
export function GuestMigrationNotice(): ReactElement | null {
  const { status, migratedCount } = useGuestMigration();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (status !== 'done') return;
    const timeout = setTimeout(() => setDismissed(true), 6000);
    return () => clearTimeout(timeout);
  }, [status]);

  if (dismissed || status === 'idle') return null;

  return (
    <div
      role="status"
      className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900"
    >
      {status === 'uploading' && 'Saving the solves you recorded as a guest…'}
      {status === 'done' &&
        `Saved ${migratedCount} solve${migratedCount === 1 ? '' : 's'} from your guest session to your account.`}
      {status === 'failed' &&
        'Could not upload your guest solves yet. They are still on this device and will be saved next time.'}
    </div>
  );
}
