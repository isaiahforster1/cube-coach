import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id. The library exposes this as an ambient const enum, which cannot be imported
 * under `verbatimModuleSyntax`, so the value is stated directly. It is part of the
 * Argon2 specification and will not change.
 */
const ARGON2ID = 2;

/**
 * Argon2id parameters, stated explicitly rather than relying on library defaults.
 *
 * These are OWASP's recommended minimum: 19 MiB of memory, two iterations, one lane.
 *
 * Argon2id is *memory-hard* on purpose. A GPU can compute billions of simple hashes per
 * second, but it cannot give billions of parallel threads 19 MiB each — memory, not
 * arithmetic, becomes the bottleneck, which is what makes offline cracking expensive.
 *
 * The parameters are encoded inside every hash string, so raising them later does not
 * invalidate existing passwords: old hashes keep verifying with the settings they were
 * created with, and can be upgraded on next login.
 */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plainText: string): Promise<string> {
  return hash(plainText, OPTIONS);
}

/**
 * Check a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed or unrecognised hash. A corrupted
 * row should fail the login, not crash the endpoint — and the caller has no useful way
 * to distinguish "wrong password" from "unparseable hash" anyway.
 */
export async function verifyPassword(storedHash: string, plainText: string): Promise<boolean> {
  try {
    return await verify(storedHash, plainText, OPTIONS);
  } catch {
    return false;
  }
}

/**
 * A hash of a throwaway value, used to spend the same time verifying a password for an
 * email that does not exist as for one that does.
 *
 * Without this, a login attempt for an unknown user returns noticeably faster than one
 * for a known user, and that difference is enough to enumerate which email addresses
 * have accounts. Generated once at startup, since the value itself is irrelevant.
 */
export const DUMMY_HASH_PROMISE: Promise<string> = hashPassword(
  'this value exists only to burn the same CPU time as a real verification',
);
