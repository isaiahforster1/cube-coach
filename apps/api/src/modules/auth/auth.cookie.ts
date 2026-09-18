import type { FastifyReply } from 'fastify';
import { SESSION_DURATION_MS } from './session.js';

export const SESSION_COOKIE = 'cube_coach_session';

/**
 * How the session cookie is set.
 *
 * - `httpOnly` keeps JavaScript from reading it, so a cross-site scripting bug cannot
 *   steal the session. This is the single most valuable flag here, and it is the reason
 *   the token is not kept in `localStorage`.
 * - `secure` restricts it to HTTPS in production. It is off in development because
 *   `localhost` is not served over TLS.
 * - `sameSite: 'lax'` stops the browser attaching the cookie to cross-site POSTs, which
 *   is what makes CSRF attacks fail. "Lax" rather than "strict" so that following a
 *   link into the app from elsewhere still arrives logged in.
 * - `path: '/'` so it is sent to every endpoint.
 */
function cookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  } as const;
}

export function setSessionCookie(reply: FastifyReply, token: string, isProduction: boolean): void {
  void reply.setCookie(SESSION_COOKIE, token, {
    ...cookieOptions(isProduction),
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply, isProduction: boolean): void {
  // The clearing cookie must carry the same path and flags as the one it replaces, or
  // the browser treats it as a different cookie and leaves the original in place.
  void reply.clearCookie(SESSION_COOKIE, cookieOptions(isProduction));
}
