import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { LoginRequest, PublicUser, RegisterRequest } from '@cube-coach/shared';
import { api, ApiError } from '../../lib/api-client.js';

export const SESSION_QUERY_KEY = ['session'] as const;

interface SessionResponse {
  user: PublicUser;
}

/**
 * The currently signed-in user, or null when nobody is signed in.
 *
 * A 401 is deliberately *not* treated as an error. "Nobody is logged in" is a normal
 * answer to this question, not a failure — if it threw, every page would have to
 * distinguish "the request failed" from "you are logged out", which is the same
 * distinction made once here.
 */
export function useSession(): UseQueryResult<PublicUser | null, Error> {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      try {
        const { user } = await api.get<SessionResponse>('/auth/me');
        return user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
    // The session is the one thing worth re-checking when the user comes back to the
    // tab: they may have logged out in another window.
    refetchOnWindowFocus: true,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentials: LoginRequest) =>
      api.post<SessionResponse>('/auth/login', credentials),
    onSuccess: ({ user }) => {
      // Seed the cache directly instead of invalidating it. The response already
      // contains the user, so refetching /auth/me would be a second round trip for
      // information we are holding.
      queryClient.setQueryData(SESSION_QUERY_KEY, user);
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (details: RegisterRequest) => api.post<SessionResponse>('/auth/register', details),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSuccess: async () => {
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
      // Drop everything else too. Cached solves and statistics belong to the user who
      // just left, and showing them to whoever logs in next would be a data leak.
      await queryClient.invalidateQueries();
    },
  });
}
