import type { User } from '@prisma/client';
import type { LoginRequest, PublicUser, RegisterRequest } from '@cube-coach/shared';
import { ApiError } from '../../plugins/error-handler.js';
import type { AuthRepository } from './auth.repository.js';
import type { GoogleProfile } from './google.js';
import { DUMMY_HASH_PROMISE, hashPassword, verifyPassword } from './password.js';
import {
  createSessionToken,
  hashSessionToken,
  SESSION_TOUCH_INTERVAL_MS,
  sessionExpiry,
} from './session.js';

export interface AuthenticatedSession {
  readonly user: User;
  readonly sessionId: string;
}

/** Strip everything a client has no business seeing — above all, the password hash. */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}

export function createAuthService(repository: AuthRepository) {
  return {
    async register(
      input: RegisterRequest,
      userAgent: string | null,
    ): Promise<{ user: User; token: string }> {
      const existing = await repository.findUserByEmail(input.email);
      if (existing !== null) {
        // Registration cannot avoid revealing that an email is taken — the user has to
        // be told. Login, which has no such obligation, is careful not to. See below.
        throw new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'That email is already registered');
      }

      const user = await repository.createUser({
        email: input.email,
        passwordHash: await hashPassword(input.password),
        displayName: input.displayName,
      });

      return { user, token: await this.startSession(user.id, userAgent) };
    },

    async login(
      input: LoginRequest,
      userAgent: string | null,
    ): Promise<{ user: User; token: string }> {
      const user = await repository.findUserByEmail(input.email);

      // Verify against a throwaway hash when the user does not exist, so both cases take
      // the same time. Returning early here would make an unknown email measurably
      // faster to reject, which is enough to enumerate who has an account.
      const passwordMatches = await verifyPassword(
        user?.passwordHash ?? (await DUMMY_HASH_PROMISE),
        input.password,
      );

      if (user === null || !passwordMatches) {
        // One message for both cases, deliberately. "No such user" and "wrong password"
        // are different facts, and telling them apart hands an attacker a list of valid
        // accounts to attack.
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      }

      return { user, token: await this.startSession(user.id, userAgent) };
    },

    /**
     * Sign in with Google, creating or linking an account as needed.
     *
     * Three cases, in order: an account already linked to this Google subject; an account
     * with the same email and no Google account yet, which gets linked; or a new account.
     * An account with the same email but a different Google subject is refused.
     *
     * Linking by email is only safe because Google is asked whether the address is
     * verified, and an unverified one is refused outright. Without that check, anyone who
     * could create a Google account claiming someone else's address could take over their
     * CubeCoach account — which is the classic way this integration goes wrong.
     *
     * The check covers only half of it. Registration does not verify email either, so the
     * account being linked into may have been prepared by an attacker who registered the
     * victim's address first ("pre-hijacking"). The verified Google identity is therefore
     * the first real proof of ownership, and linking discards everything that came before
     * it: the password is cleared and every existing session is revoked.
     */
    async signInWithGoogle(
      profile: GoogleProfile,
      userAgent: string | null,
    ): Promise<{ user: User; token: string }> {
      if (!profile.emailVerified) {
        throw new ApiError(
          403,
          'GOOGLE_EMAIL_UNVERIFIED',
          'Your Google account does not have a verified email address',
        );
      }

      const linked = await repository.findUserByGoogleId(profile.sub);
      if (linked !== null) {
        return { user: linked, token: await this.startSession(linked.id, userAgent) };
      }

      const existing = await repository.findUserByEmail(profile.email);
      if (existing !== null && existing.googleId !== null) {
        // The address already belongs to a different Google account. Most likely it was
        // reassigned — a workspace administrator gave it to someone new — and the newcomer
        // has no claim on the previous holder's history. Accounts are matched on subject,
        // not email (ADR-0013), so this is refused rather than re-linked.
        throw new ApiError(
          409,
          'GOOGLE_ACCOUNT_MISMATCH',
          'That email address is already linked to a different Google account',
        );
      }

      if (existing !== null) {
        const user = await repository.linkGoogleAccount(existing.id, profile.sub, new Date());
        return { user, token: await this.startSession(user.id, userAgent) };
      }

      const user = await repository.createGoogleUser({
        email: profile.email,
        displayName: profile.name,
        googleId: profile.sub,
      });

      return { user, token: await this.startSession(user.id, userAgent) };
    },

    async startSession(userId: string, userAgent: string | null): Promise<string> {
      const token = createSessionToken();

      await repository.createSession({
        userId,
        // Only the hash is stored. The plain token exists in the response cookie and
        // nowhere else, so a database dump yields no usable sessions.
        tokenHash: hashSessionToken(token),
        expiresAt: sessionExpiry(),
        userAgent,
      });

      return token;
    },

    async logout(token: string): Promise<void> {
      await repository.revokeSession(hashSessionToken(token), new Date());
    },

    /**
     * Resolve a session token to a user, or null if it is unusable for any reason.
     *
     * Instant revocation is the reason this project uses opaque tokens rather than
     * JWTs: this lookup consults the database on every request, so revoking a session
     * takes effect immediately rather than whenever the token would have expired.
     */
    async authenticate(token: string): Promise<AuthenticatedSession | null> {
      const now = new Date();
      const session = await repository.findActiveSession(hashSessionToken(token), now);

      if (session === null) return null;

      // Record activity, but not on every request — one write per hour per session is
      // enough to distinguish an active login from an abandoned one, and avoids turning
      // every read into a write.
      if (now.getTime() - session.lastUsedAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
        await repository.touchSession(session.id, now);
      }

      return { user: session.user, sessionId: session.id };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
