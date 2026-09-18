import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { SESSION_COOKIE } from '../modules/auth/auth.cookie.js';
import type { AuthService } from '../modules/auth/auth.service.js';
import { ApiError } from './error-handler.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireAuth`. Undefined on routes that do not use it. */
    currentUser?: User;
  }

  interface FastifyInstance {
    /** Use as a route `preHandler` to require a logged-in user. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Registers `app.requireAuth`, a preHandler that rejects unauthenticated requests
 * before the route body runs.
 *
 * Authentication is opt-in per route rather than global-with-exceptions. Both designs
 * are defensible, but the failure modes differ: forgetting to opt in leaves an endpoint
 * public, while forgetting to add an exception breaks login in an obvious, immediate
 * way. Opt-in is chosen here because the routes needing auth are listed explicitly and
 * are easy to audit — and the tests assert that each protected route rejects anonymous
 * requests.
 */
export function registerAuthentication(app: FastifyInstance, authService: AuthService): void {
  app.decorateRequest('currentUser', undefined);

  app.decorate('requireAuth', async (request: FastifyRequest, _reply: FastifyReply) => {
    const token = request.cookies[SESSION_COOKIE];

    if (token === undefined || token === '') {
      throw new ApiError(401, 'NOT_AUTHENTICATED', 'You must be signed in');
    }

    const session = await authService.authenticate(token);

    if (session === null) {
      throw new ApiError(401, 'SESSION_INVALID', 'Your session has expired or is no longer valid');
    }

    request.currentUser = session.user;
  });
}

/**
 * Read the authenticated user inside a handler.
 *
 * `request.currentUser` is optional on the type, because most routes do not set it.
 * This narrows it once, in one place, instead of every handler asserting it is present.
 */
export function currentUser(request: FastifyRequest): User {
  if (request.currentUser === undefined) {
    throw new ApiError(401, 'NOT_AUTHENTICATED', 'You must be signed in');
  }
  return request.currentUser;
}
