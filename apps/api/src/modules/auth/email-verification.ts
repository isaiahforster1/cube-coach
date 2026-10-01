import { createHash, randomBytes } from 'node:crypto';
import type { User } from '@prisma/client';
import { ApiError } from '../../plugins/error-handler.js';
import type { EmailMessage, EmailSender } from '../email/email-sender.js';
import type { AuthRepository } from './auth.repository.js';

/**
 * How long a verification link works.
 *
 * Short, because a link is a credential sitting in an inbox, and anyone who later reads
 * that inbox, or a forwarded copy, could use it. Asking for another link costs one click.
 */
export const VERIFICATION_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

/** 256 random bits, like a session token, so guessing one is not a realistic attack. */
function createVerificationToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256, not Argon2, for the reason given in session.ts: the token is long and random,
 * so there is no dictionary to try and a slow hash buys nothing. Storing only the hash
 * means a database dump holds no usable links.
 */
export function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The email itself, built from fixed text and the link and nothing else.
 *
 * Deliberately no display name. The registrant may be an attacker using a victim's
 * address, and whatever they typed would arrive in the victim's inbox from our domain.
 */
export function verificationEmail(to: string, link: string): EmailMessage {
  return {
    to,
    subject: 'Confirm your email address for CubeCoach',
    text: [
      'Someone created a CubeCoach account with this email address.',
      '',
      'If it was you, confirm the address by opening this link in a browser where you are',
      'signed in to CubeCoach. It works once and expires in an hour.',
      '',
      link,
      '',
      "If it wasn't you, ignore this email.",
    ].join('\n'),
    // The link is the only value inserted, and it is built from configuration and a
    // base64url token, neither of which can contain markup.
    html: [
      '<p>Someone created a CubeCoach account with this email address.</p>',
      '<p>If it was you, confirm the address by opening this link in a browser where you are ',
      'signed in to CubeCoach. It works once and expires in an hour.</p>',
      `<p><a href="${link}">Confirm my email address</a></p>`,
      "<p>If it wasn't you, ignore this email.</p>",
    ].join(''),
  };
}

export function createEmailVerificationService(
  repository: AuthRepository,
  sender: EmailSender,
  appUrl: string,
) {
  return {
    /**
     * Issue a new link and email it, replacing any earlier one.
     *
     * The token goes in the URL fragment, which browsers never send to a server, so it
     * stays out of access logs, proxies and Referer headers. The page reads it and posts
     * it, rather than a GET doing the verifying, because mail scanners follow links in
     * incoming mail and would use the token up before the person ever clicked.
     */
    async sendLink(user: { readonly id: string; readonly email: string }): Promise<void> {
      const token = createVerificationToken();

      await repository.replaceVerificationToken({
        userId: user.id,
        email: user.email,
        tokenHash: hashVerificationToken(token),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_LIFETIME_MS),
      });

      const link = new URL(`/verify-email#token=${token}`, appUrl).toString();
      await sender.send(verificationEmail(user.email, link));
    },

    /**
     * Verify the signed-in user's address with a token from their link.
     *
     * Every way a token can be wrong gives the same error: unknown, used, expired, sent to
     * another address or belonging to someone else. Telling them apart would only help
     * someone probing for valid tokens.
     */
    async verify(userId: string, token: string): Promise<User> {
      const user = await repository.consumeVerificationToken(
        userId,
        hashVerificationToken(token),
        new Date(),
      );

      if (user === null) {
        throw new ApiError(
          400,
          'VERIFICATION_LINK_INVALID',
          'This link is invalid or has expired. You can ask for a new one.',
        );
      }

      return user;
    },
  };
}

export type EmailVerificationService = ReturnType<typeof createEmailVerificationService>;
