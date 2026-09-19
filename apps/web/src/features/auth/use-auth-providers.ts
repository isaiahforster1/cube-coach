import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api-client.js';

export interface AuthProviders {
  readonly password: boolean;
  readonly google: boolean;
}

/**
 * Which sign-in options the server actually has configured.
 *
 * Asking rather than assuming means a "Continue with Google" button never appears unless
 * pressing it would work. An option that fails when used is worse than one that is
 * absent — it looks broken, and the user has no way to tell whether the fault is theirs.
 */
export function useAuthProviders() {
  return useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => api.get<AuthProviders>('/auth/providers'),
    // Configuration does not change while someone is looking at a login form.
    staleTime: Infinity,
  });
}
