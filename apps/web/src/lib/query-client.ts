import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client.js';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /**
         * Retry network and server failures, but never client errors.
         *
         * Retrying a 401 or a 400 is pointless — the request was understood and
         * rejected, and sending it again changes nothing except delaying the error the
         * user needs to see. A 500 or a dropped connection genuinely might succeed on a
         * second attempt.
         */
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
        staleTime: 30_000,
      },
      mutations: {
        // A mutation changes something. Retrying automatically risks doing it twice,
        // so retries are opt-in per mutation rather than the default.
        retry: false,
      },
    },
  });
}
