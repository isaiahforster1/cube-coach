# ADR-0019: Email verification, proving the inbox and the password together

## Status

Accepted — 2026-09-29

Amends [ADR-0018](0018-authorisation-and-identity-rules.md), rule 3: a password whose email
has been verified is now a proved credential, and survives a Google link.

## Context

Registration never proved that the person typing an email address owned it. That allowed
account pre-hijacking (ADR-0018): an attacker registers the victim's address with a password
of their own, and when the victim later signs in with Google, the two are linked.

The fix so far treats every password as unproved. Linking by email clears it and revokes
every session. That is safe, but a genuine user who registered with a password and later
uses Google loses the password without warning.

ADR-0018 said that once registration verifies email, a verified password may survive the
link. This ADR adds that verification.

Two constraints shaped it. The app is guest-first (ADR-0012), so verification must not
become a gate. And the project had no outbound email at all.

## Decision

### What verification proves

**Verifying requires both the emailed link and a signed-in session for the same account.**
The link proves the person reads the inbox. The session proves they hold the password.
Only the two together show that whoever chose the password also owns the address.

A link alone is not enough. An attacker registers `victim@gmail.com`, the victim gets a
"confirm your email" message and clicks it, and the attacker's password becomes a
"verified" one that would now survive a Google link. With the session required, the victim
lands on a sign-in page for a password they do not know, and nothing is verified.

### The token

- 256 random bits from `randomBytes`, sent as base64url.
- **Stored only as a SHA-256 hash**, the same as a session token, so a database dump holds
  no usable links. A slow hash buys nothing for a long random value.
- **Single use.** Using it is one conditional `UPDATE ... WHERE used_at IS NULL AND
expires_at > now() AND user_id = $caller AND email = $current_address`. Two racing
  requests cannot both succeed: Postgres locks the row, and the second re-checks the
  condition after the first commits.
- **Expires after one hour.** A link is a credential sitting in an inbox. Asking for
  another costs one click.
- **One outstanding per user.** Issuing a token deletes the user's earlier ones. The table
  stays bounded however often someone presses "resend" (ADR-0018, rule 4), and an older
  link stops working as soon as a newer one exists.
- **Bound to the address it was sent to.** If the account's address changes, an old link
  cannot verify the new one.

### The link

`{APP_URL}/verify-email#token=…`

- **The token is in the fragment.** Browsers never send the fragment to a server, so it
  stays out of access logs, proxy logs and `Referer` headers. The page reads it, removes it
  from the address bar, and posts it.
- **A POST verifies it, never a GET.** Mail security scanners follow links in incoming
  mail. A GET that verified would use the token up before the person ever clicked.
- **`APP_URL` is configuration, never the request's `Host` header.** A link built from the
  header lets anyone who can send a request with a forged `Host` make the application mail
  its users a link to the attacker's site ("host header poisoning"). Production must set it
  whenever email is configured. The `localhost` default applies outside production only.

### The endpoints

Both require a session and are limited per account, after authentication, like solve
writes.

| Endpoint                         | Limit      | Behaviour                                                                                                                                                     |
| -------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/verify-email`        | 10 / 15min | Body `{ token }`, checked by zod as 43 base64url characters. Every bad token (unknown, used, expired, another user's) gives one identical 400.                |
| `POST /auth/resend-verification` | 3 / 15min  | Takes **no address**. The session decides where the mail goes, so it cannot send to a stranger or reveal who has an account. Verified accounts: 204, no mail. |

Nothing here reveals which addresses are registered, because neither endpoint accepts an
address. (Registration itself still does, with its 409. It has to tell the user, and that
was already accepted in the original auth design.)

### The email

Fixed text plus the link. **No display name, or anything else the registrant typed.** The
registrant may be an attacker using a victim's address, and whatever they typed would
arrive in the victim's inbox from our domain. A display name of "Claim your prize at
evil.example" is a phishing email we would be sending for them.

Registration awaits the send but does not fail if it fails: the error is logged and the
user can ask again. The resend endpoint does report a failure (503 `EMAIL_NOT_SENT`),
because the user asked for exactly that.

### Unverified accounts keep working

Chosen by the product owner. An unverified account can sign in and save solves exactly as
before. The only difference is at a Google link:

| Account being linked into | Password | Existing sessions |
| ------------------------- | -------- | ----------------- |
| Email verified            | kept     | kept              |
| Email not verified        | cleared  | all revoked       |

The state is shown in the account menu only ("Email not confirmed", with a button for a new
link). No banner, no badge, in line with ADR-0012. Accounts created by or linked to Google
are verified on the spot, since Google refuses unverified addresses (ADR-0013). The
migration backfills that for existing Google-linked accounts. Password-only accounts stay
unverified, because nothing ever proved their address.

### The provider

**Resend**, chosen by the product owner. It has a free tier that covers this project's
volume, and it is one JSON POST over HTTPS, so no SDK is added. HTTPS also avoids SMTP,
which Railway blocks outbound on its cheaper plans.

It sits behind a one-method interface, `EmailSender.send(message)`:

- `createResendEmailSender`, with an injectable `fetch` and a 10-second timeout. Its errors
  carry the status only, never the key or the recipient, because they are logged.
- `createLogEmailSender`, **development only**, which writes the email to the terminal so
  the link can be copied without a mail account. Never used in production, where logs are
  shipped and kept.
- A fake in `src/test/fake-email-sender.ts`, which **every test** uses through the test
  context, whatever the local `.env` configures.

Production without `RESEND_API_KEY` sends nothing. `GET /auth/providers` then reports
`emailVerification: false`, the client offers no button, and every password stays
unproved: exactly the behaviour before this ADR, which is safe.

## Consequences

**Made easier.** A user who registered with a password and confirms it keeps that password
when they start using Google. Changing email provider means one new implementation of
`send`. The sender, the token rules and the UI are all testable without a network.

**Made harder.** Verifying needs a signed-in browser. Someone who registers on a laptop and
opens the email on a phone has to sign in on the phone first. The page explains this and
brings them back afterwards. The OAuth round trip does not carry that return path, so a
user who signs in with Google from that page has to open the link again. Also, the project
now depends on a third-party service and a DNS setup, both of which have to be done by hand.

**Still open.**

- **Address squatting.** An attacker can register someone's address and never verify it.
  The owner then cannot register a password account with that address (409). They can
  still sign in with Google, which links and discards the squatter's password. A job that
  deletes accounts left unverified for N days would close this, and needs a scheduler the
  project does not have.
- **Recycled addresses and verified passwords.** If a workspace administrator gives
  `alex@company.com` to someone new, and the old holder had a verified password account
  with no Google link, the newcomer's Google sign-in links into it and the old password
  survives. Both people then hold the account. Before this ADR the old holder was locked
  out instead. Both outcomes are the same underlying problem: email is being used as
  identity. Matching Google on subject (ADR-0013) already limits it to accounts that have
  never used Google.
- **No password reset and no email change.** When either is added, it must revoke every
  session (as ADR-0018 says) and, for email change, clear `email_verified_at`.

## Alternatives considered

**Verifying from the link alone, without a session.** Simpler, and one click from any
device. Rejected because it lets pre-hijacking survive verification, as described above.
This is the standard design, and the gap is easy to miss.

**A GET link that verifies directly.** Also simpler. Mail scanners and link previews spend
the token, and it puts the token in the query string, where every log on the way sees it.

**A six-digit code instead of a link.** Scanner-proof and works across devices. It is
low-entropy, so it needs strict attempt limits, and it is more to type on a phone.
Worth revisiting if cross-device confirmation turns out to annoy people.

**Blocking sign-in until the address is verified.** The strongest guarantee, and it closes
squatting too. Rejected by the product owner as the wrong friction for a guest-first app
(ADR-0012): the account exists to keep solves, and a lost email would lock them out.

**Postmark, Amazon SES or plain SMTP.** Postmark has better deliverability and needs an
account approval before sending to anyone. SES is cheapest at volume but needs the AWS SDK
for request signing and a request to leave its sandbox. SMTP adds `nodemailer` and is
blocked outbound on Railway's cheaper plans. The interface keeps any of these a one-file
change.

## Setup

Not automatic. See [deployment.md](../deployment.md#email-verification-resend) for the
Resend account, DNS records and Railway variables.
