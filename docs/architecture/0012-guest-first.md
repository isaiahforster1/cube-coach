# ADR-0012: The account is optional

## Status

Accepted — 2026-09-19

## Context

Until now every page required an account. Someone arriving to see whether the timer was
any good had to register first — handing over an email address to find out whether they
wanted to.

That is backwards for a tool whose value is obvious within thirty seconds of using it.
The account is worth having for a reason that only becomes real later: keeping solves, and
having them follow you between devices.

## Decision

Everything works without an account. Timer, history, statistics and cube are all reachable
by anyone, and a guest's solves are kept in their browser.

The mechanism is a `SolveStore` interface with two implementations, one backed by the API
and one by `localStorage`. `useSolveStore()` picks between them from the session, and every
hook and component depends on the interface rather than on whether an account exists.

Statistics for a guest are computed in the browser by `buildStatsSummary`, the same pure
function the server runs. Not a second implementation: a guest and an account holder cannot
be shown different numbers for the same solves.

Signing in is a small text link in the corner. No banner, no modal on arrival, no badge, no
counter urging anyone to register.

When a guest does sign in, their solves are uploaded to their account and the local copy is
cleared, but only once every solve has been accepted.

## Consequences

**Made easier.** Someone can try the product immediately, which is the point. The
conversion moment becomes an informed one: you sign up when you have solves worth keeping,
not to find out whether you want any.

The store interface also made the feature far smaller than it first appeared. Because
history, statistics and the timer already depended on hooks rather than on `fetch`
directly, guest mode was one branch in one place instead of a condition threaded through
every component.

**Made harder.** There are now two implementations of solve storage to keep in step. Both
are covered by tests asserting the same behaviours (idempotent creation, soft delete with
restore, newest-first paging) so a divergence should surface quickly.

A guest's solves live in one browser and can be cleared by the user or evicted under
storage pressure. The interface says "saved on this device" rather than "saved", because a
reassuring tick over data that exists in exactly one place is a lie that only becomes
apparent when it is too late to fix.

**The migration is the risk.** Uploading is safe to retry because creating a solve is
idempotent on the client-generated id (ADR-0009), so a half-finished migration resumed
later cannot duplicate anything. The local copy is deliberately cleared last: if the upload
fails, the solves stay where they are and the next sign-in tries again.

## Alternatives considered

**Require an account, as before.** Simplest, and it asks for a commitment before
demonstrating any value.

**A trial account created silently on first visit.** Gives every visitor real server-side
storage with no form to fill in. Rejected because it creates a database row for every
passer-by, needs a policy for reaping them, and quietly makes an account for someone who
did not ask for one.

**Local-first for everyone, syncing to the server when signed in.** Genuinely appealing:
one storage path, offline by default, and the server becomes a sync target. Rejected as
considerably more machinery (conflict resolution, tombstones, ordering) than the problem
currently needs. Worth revisiting if offline use becomes a priority.
