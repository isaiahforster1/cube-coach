import { z } from 'zod';

/**
 * Request and response shapes for authentication, shared by the API and the client.
 *
 * One schema is the single source of truth: the server validates incoming requests
 * against it at runtime, and the client derives its TypeScript types from the same
 * definition. The two cannot drift apart, because there is only one of them.
 */

/**
 * Emails are trimmed and lowercased before validation, so `A@B.com ` and `a@b.com` are
 * the same account. Normalising here means it happens identically on both sides rather
 * than being remembered in each place an email is handled.
 *
 * 254 characters is the maximum length of a valid email address.
 */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/**
 * A minimum length, and no composition rules.
 *
 * Length is the property that actually resists guessing. Forcing a symbol and a digit
 * mostly produces `Password1!`, which is in every cracking dictionary — current NIST
 * guidance recommends against composition rules for exactly that reason.
 *
 * The maximum exists for a different reason: hashing cost grows with input size, so an
 * unbounded password field is a denial-of-service vector.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1, 'Display name is required').max(50),
});

export const loginRequestSchema = z.object({
  email: emailSchema,
  /**
   * Deliberately *not* `passwordSchema`. Login must accept whatever the user actually
   * has, not whatever today's policy would require — otherwise raising the minimum
   * length locks out every existing account.
   */
  password: z.string().min(1, 'Password is required').max(128),
});

/** The user as the API returns it. Never includes the password hash. */
export const publicUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  createdAt: z.iso.datetime(),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
