import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyEmailRequestSchema } from '@cube-coach/shared';
import { currentUser } from '../../plugins/authenticate.js';
import { ApiError } from '../../plugins/error-handler.js';
import { toPublicUser } from './auth.service.js';
import type { EmailVerificationService } from './email-verification.js';

export interface EmailVerificationLimits {
  /** Verification attempts per account per 15 minutes. */
  readonly verificationMax: number;
  /**
   * Links sent per account per 15 minutes. Each one is an email from our domain, and a
   * provider suspends senders whose mail is reported as unwanted.
   */
  readonly resendMax: number;
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

  /**
   * Send a new link to the signed-in account's own address.
   *
   * It takes no address. The session decides where the email goes, so this cannot be used
   * to send mail to a stranger or to ask whether some address has an account.
   */
  app.post(
    '/auth/resend-verification',
    {
      preHandler: app.requireAuth,
      config: perAccountLimit('resend-verification', limits.resendMax),
    },
    async (request, reply) => {
      const user = currentUser(request);

      if (user.emailVerifiedAt === null) {
        try {
          await service.sendLink(user);
        } catch (error) {
          request.log.error({ err: error }, 'Could not send the verification email');
          throw new ApiError(
            503,
            'EMAIL_NOT_SENT',
            "We couldn't send the email just now. Please try again later.",
          );
        }
      }

      return reply.status(204).send();
    },
  );
}
