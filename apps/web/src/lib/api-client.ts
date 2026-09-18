/**
 * The single place the browser talks to the API.
 *
 * Everything goes through here so that credentials, headers and error handling are
 * decided once rather than remembered at every call site.
 */

const API_BASE_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3000/api/v1';

/** An error the API returned deliberately, in its documented shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      /**
       * The reason this wrapper exists at all.
       *
       * `fetch` does not send cookies to a different origin unless told to, and the web
       * client (port 5173) and the API (port 3000) are different origins. Without this
       * the session cookie is silently dropped and every request looks logged out —
       * with no error to explain why.
       */
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...init.headers,
      },
    });
  } catch (cause) {
    // fetch only rejects when the request never completed: offline, DNS failure, CORS
    // refusal. An HTTP error status is a successful request with a bad answer, and is
    // handled below.
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server', cause);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = body as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      parsed?.error?.code ?? 'UNKNOWN_ERROR',
      parsed?.error?.message ?? 'Something went wrong',
      parsed?.error?.details,
    );
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
};
