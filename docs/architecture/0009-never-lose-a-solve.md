# ADR-0009: Never lose a solve

## Status

Accepted — 2026-09-18

## Context

For a timing product, losing a solve is the worst possible failure. A cuber who has just
set a personal best and watches it vanish will not use the tool again, and no amount of
good statistics compensates.

Duplicating one is nearly as bad, because it silently corrupts every average that solve
appears in.

Both failures come from the same place: the gap between measuring a solve in the browser
and storing it on a server. Networks drop, tabs close, laptops sleep, and servers restart
— and all of it happens most often on the worst connections, which is exactly when
someone is practising on a phone.

## Decision

Two mechanisms, addressing the two halves of the problem.

**Idempotent creation.** The client generates a UUID for the solve before sending it. The
server upserts on that id with an empty update: a second request with the same id returns
the existing row and changes nothing. Retrying is therefore always safe.

**A durable queue.** The solve is written to `localStorage` _before_ the request is
attempted, and removed only once the server has acknowledged it. Anything still in the
queue is retried on page load and whenever the browser reports the connection has
returned.

The interface reports the truth: a solve shows as "saved" only when the server has
confirmed it, and as "saved on this device only" while it is still queued.

## Consequences

**Made easier.** A dropped connection, a closed tab or a crash between the measurement and
the acknowledgement costs nothing — the solve is on disk and is sent later. Because the
write is idempotent, the retry cannot produce a duplicate, so the two mechanisms are safe
to combine. Without idempotency, aggressive retrying would be _worse_ than losing the
solve.

**Made harder.** There is now client state that can disagree with the server, and the
interface has to be honest about which solves are only local.

Corrections have two paths: a penalty on a solve that is still queued is applied to the
queued copy, while one already stored goes through `PATCH`. That is a real branch, and it
is tested.

**Accepted limits.** The queue is per-browser. A solve recorded offline on a phone stays
on that phone until that browser is opened online again. `localStorage` can also be
cleared by the user or evicted under storage pressure, so it is durable but not
guaranteed. IndexedDB would be sturdier and is the upgrade if this proves insufficient.

A permanently rejected solve — a 4xx that is not 401, 408 or 429 — is dropped from the
queue. Keeping it would retry forever and block every solve behind it. This is the one
place data is deliberately discarded, and it should be rare enough to be worth logging if
it ever happens in practice.

## Alternatives considered

**Server-generated ids.** The conventional choice, and it makes idempotency impossible
without a separate idempotency-key header — which is the same idea with more moving parts.
Letting the client name the row is simpler and achieves it directly.

**Retry without a queue.** Retries in memory only, which covers a brief network blip and
nothing else. A closed tab or a crashed browser still loses the solve, and those are
common.

**IndexedDB instead of localStorage.** Larger, asynchronous, and not subject to the same
eviction pressure. Rejected for now because a solve is a few hundred bytes and the queue
is rarely more than a handful; `localStorage` is synchronous, which makes "write before
the request is attempted" trivially correct with no await in between.

**Optimistic UI with no durability.** Show the solve immediately, assume it saved. Simple,
fast, and dishonest: the failure is invisible until the user looks at another device and
finds their session missing.
