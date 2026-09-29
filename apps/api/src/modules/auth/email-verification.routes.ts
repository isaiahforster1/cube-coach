import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyEmailRequestSchema } from '@cube-coach/shared';
import { currentUser } from '../../plugins/authenticate.js';
import { toPublicUser } from './auth.service.js';
import type { EmailVerificationService } from './email-verification.js';

export interface EmailVerificationLimits {
  /** Verification attempts per account per 15 minutes. */
  readonly verificationMax: number;
}

/**
 * A limit keyed on the signed-in account rather than the IP, run after authentication
 * because the account is not known before it. An attacker controls how many addresses
 * they send from, not how many accounts they are signed in as (ADR-0018, rule 4).
 */
function perAccountLimit(name: string, max: number) {
  return {
    rateLimit: {
      max,
      timeWindow: '15 minutes',
      hook: 'preHandler' as const,
      keyGenerator: (request: FastifyRequest) => `${name}:${currentUser(request).id}`,
    },
  };
}

export function registerEmailVerificationRoutes(
  app: FastifyInstance,
  service: EmailVerificationService,
  limits: EmailVerificationLimits,
): void {
  /**
   * Verify the signed-in user's address with the token from their link.
   *
   * Signed in, deliberately. The link proves whoever clicked it reads the inbox; the
   * session proves they also hold the account's password. Without the session, a victim
   * clicking a "confirm your email" message for an account an attacker registered in
   * their name would turn the attacker's password into a verified one.
   */
  app.post(
    '/auth/verify-email',
    {
      preHandler: app.requireAuth,
      config: perAccountLimit('verify-email', limits.verificationMax),
    },
    async (request) => {
      const { token } = verifyEmailRequestSchema.parse(request.body);
      const user = await service.verify(currentUser(request).id, token);
      return { user: toPublicUser(user) };
    },
  );
}
