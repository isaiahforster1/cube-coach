import { createHash, randomBytes } from 'node:crypto';

/** 256 bits of entropy. Guessing one is not a realistic attack at this size. */
const TOKEN_BYTES = 32;

/** How long a login lasts without activity. */
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/** Refresh `lastUsedAt` at most this often, to avoid a write on every single request. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Generate a new session token.
 *
 * `randomBytes` is a cryptographically secure source. `Math.random` is not, and is
 * predictable enough that tokens derived from it have been recovered in practice.
 */
export function createSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Hash a session token for storage.
 *
 * SHA-256, not Argon2 — and the difference matters.
 *
 * Password hashing must be *slow*, because a password is low-entropy and an attacker
 * with the hashes will try billions of likely candidates. A session token is 256 random
 * bits: there is no dictionary to try and no shortcut, so making the hash slow buys
 * nothing and would cost a deliberate delay on every authenticated request.
 *
 * Hashing is still essential. A leaked database dump then contains no usable sessions,
 * exactly as it contains no usable passwords.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + SESSION_DURATION_MS);
}
