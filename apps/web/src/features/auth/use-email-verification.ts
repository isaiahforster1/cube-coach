import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PublicUser } from '@cube-coach/shared';
import { api } from '../../lib/api-client.js';
import { SESSION_QUERY_KEY } from './use-session.js';

/** Confirm the signed-in user's address with the token from their emailed link. */
export function useVerifyEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (token: string) => api.post<{ user: PublicUser }>('/auth/verify-email', { token }),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, user);
    },
  });
}

/** Email the signed-in user a new link. The server decides the address, not the client. */
export function useResendVerification() {
  return useMutation({
    mutationFn: () => api.post<void>('/auth/resend-verification'),
  });
}
