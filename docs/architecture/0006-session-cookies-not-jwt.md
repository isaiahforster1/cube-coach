# ADR-0006: Database-backed session cookies, not JWTs

## Status

Accepted — 2026-09-18

## Context

The reflexive modern default for API authentication is a JSON Web Token: a signed,
self-contained token the client stores and sends with each request. The server validates
the signature and trusts the contents without a lookup.

That property — statelessness — is the entire point of a JWT. It matters when many
services must independently validate a token, or when a database lookup per request is
genuinely too expensive.

CubeCoach has one API and one client.

Statelessness also has a cost that is easy to understate: **a JWT cannot be revoked**.
Once issued it is valid until it expires. "Log out" cannot actually log anyone out; it
only removes the token from the browser holding it. The standard mitigations — short
access tokens plus refresh tokens, rotation, reuse detection, a revocation list — end up
reintroducing exactly the server-side state the design was meant to avoid, with more
moving parts and more ways to get it wrong.

## Decision

A session is a 256-bit random token, generated with `crypto.randomBytes`, stored in the
`auth_sessions` table as a SHA-256 hash and sent to the browser in a cookie that is
`httpOnly`, `sameSite=lax`, `path=/`, and `secure` in production.

Every authenticated request looks the session up, rejecting expired and revoked ones in
the query itself.

Passwords are hashed with Argon2id at OWASP's recommended parameters — 19 MiB of memory,
two iterations, one lane.

## Consequences

**Made easier.** Revocation is immediate: logging out marks the row revoked and the very
next request with that token fails. "Sign out everywhere" is one `UPDATE`. There is no
token expiry/refresh dance, and no client-side token handling at all.

`httpOnly` means JavaScript cannot read the session, so a cross-site scripting bug cannot
steal it. A JWT in `localStorage` — the usual pairing — is readable by any script that
runs on the page.

`sameSite=lax` means the browser does not attach the cookie to cross-site POST requests,
which is what defeats CSRF without a separate token scheme.

**Made harder.** One indexed lookup per authenticated request. At this scale that is
nothing, and it buys the revocation above.

Cookies are awkward for non-browser clients. A native mobile app or a third-party
integration would want tokens. That is a real limitation, and the answer when it arrives
is to add a token flow for those clients specifically, not to convert the browser flow.

The API and the web client must be same-site for the cookie to be sent, which constrains
how they are deployed — subdomains of one domain rather than unrelated origins.

## Notes on the implementation

**Session tokens are hashed with SHA-256, not Argon2.** Password hashing must be slow,
because passwords are low-entropy and an attacker with the hashes will try billions of
likely candidates. A session token is 256 random bits: there is no dictionary and no
shortcut, so a slow hash buys nothing and would add a deliberate delay to every
authenticated request. Hashing at all is still essential — a leaked dump then contains no
usable sessions.

**Login does not reveal whether an email exists.** An unknown email and a wrong password
return an identical status, code and message. The service also verifies against a
throwaway hash when the user is not found, so both paths take the same time; without
that, an unknown email is measurably faster to reject and the endpoint becomes a way to
enumerate accounts. Registration necessarily does reveal it, because the user has to be
told.

**Credential endpoints are rate limited** to 10 attempts per 15 minutes per IP. Argon2 is
deliberately expensive, which makes an unthrottled login endpoint both a
credential-stuffing target and a way to exhaust the server's CPU.

## Alternatives considered

**JWT access tokens with refresh-token rotation.** The industry default. Rejected because
its benefit does not apply here and its costs are immediate. Worth revisiting if a mobile
client appears.

**A managed provider (Clerk, Auth0, Supabase Auth).** Would reduce this milestone to an
afternoon and would be the right call under commercial time pressure. Rejected because
implementing authentication once, by hand, is among the most valuable things in this
project, and because it avoids a vendor dependency in the critical path.

**bcrypt instead of Argon2id.** Still acceptable, and very widely deployed. Argon2id is
memory-hard, which resists GPU cracking in a way bcrypt's much smaller memory footprint
does not, and it is the current OWASP first choice.

**Storing the session token unhashed.** Simpler, and wrong for the same reason storing
passwords in plain text is wrong: it converts a database read into a full account
compromise.
