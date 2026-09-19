# ADR-0013: Google sign-in, as an option rather than a replacement

## Status

Accepted — 2026-09-19

## Context

Email and password works, and it is friction. Someone who wants their solves kept has to
invent and remember another password, and we have to be trusted to store it properly.

## Decision

Google sign-in using the OAuth 2.0 authorization code flow, alongside the existing password
login rather than instead of it.

The code exchange happens server-side, so the client secret never reaches the browser and
the browser never handles an access token. Only `openid email profile` is requested, which
is enough to identify the account and nothing more.

Three database changes: `password_hash` becomes nullable, because an account that only uses
Google never has one; a unique `google_id` column stores Google's subject identifier; and
accounts are matched on that subject rather than on the email address, because an email can
be reassigned by a workspace administrator and a subject cannot.

Sign-in resolves in three steps: an account already linked to that subject, then an account
with the same email which gets linked, then a new account.

**The whole linking design rests on one check.** Google is asked whether the email is
verified, and an unverified address is refused outright. Without it, anyone able to create a
Google account claiming someone else's address could take over their CubeCoach account. This
is the standard way the integration is got wrong, and there are two tests for it.

Credentials are optional configuration. When absent, the routes are not registered and the
client does not render the button, because an option that fails when pressed is worse than
one that is absent: it looks broken, and the user cannot tell whether the fault is theirs.

## Consequences

**Made easier.** One fewer password for a new user to invent, and one fewer for us to be
responsible for. Someone who registered with a password and later uses Google keeps one
account and one solve history rather than silently splitting it in two.

**Made harder.** A second authentication path to reason about. A passwordless account must
fail a password login the same way a wrong password does, with the same status, the same
message and the same work done, so the response cannot be used to discover which accounts
use Google. There is a test for that.

The flow cannot be tested end to end without real credentials. The exchange is therefore
written against an injectable `fetch`, so everything except Google's own behaviour is
covered, and the account-linking logic is tested against the real database.

**What is deliberately not done.** No refresh token is requested, because we never act on
the user's behalf after sign-in. Nothing from the profile is stored beyond subject, email and
display name.

## Setup

Not automatic, and cannot be: it needs a Google Cloud OAuth client, created by hand.

1. Create an OAuth 2.0 Client ID at <https://console.cloud.google.com/apis/credentials>.
2. Register `http://localhost:3000/api/v1/auth/google/callback` as an authorised redirect
   URI, and the production equivalent when there is one.
3. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` in
   `apps/api/.env`. They are commented out in `.env.example`.

Until then `GET /auth/providers` reports `google: false` and nothing about the option
appears.

## Alternatives considered

**Google only, dropping passwords.** Simpler, and it makes an account dependent on a third
party. Anyone without a Google account, or unwilling to use one here, is shut out.

**An authentication provider such as Clerk or Auth0.** Would cover Google, Apple, GitHub and
more for far less work. Rejected for the same reason as in ADR-0006: implementing this once
by hand is among the most valuable things in the project, and it keeps a vendor out of the
critical path.

**Implicit flow, exchanging the token in the browser.** Simpler to build and discouraged for
good reason, because the token is exposed to anything running on the page. The authorization
code flow keeps it server-side.
