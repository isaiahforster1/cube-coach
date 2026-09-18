# ADR-0007: Version the API in the URL, with health checks outside it

## Status

Accepted — 2026-09-18

## Context

Once a client exists, endpoint paths become a contract. Changing the shape of a response
breaks every copy of the client already running — and in a browser app, "already
running" includes tabs that have been open for days.

Versioning is the escape hatch: a breaking change ships as a new version while the old
one keeps working, and clients migrate on their own schedule.

The decision was taken in M5 rather than later specifically because nothing had hardcoded
a path yet. Introducing a prefix after a client exists means changing both sides
simultaneously, which is exactly the coordinated deployment versioning is meant to avoid.

## Decision

Application endpoints live under `/api/v1`. Health probes stay at the root, unversioned.

```
/health              liveness
/health/ready        readiness
/api/v1/auth/login   application
```

Fastify mounts the versioned routes through a scoped plugin with a `prefix`, so the route
definitions themselves contain no version string. Moving to v2 means registering the same
handlers — or new ones — under a different prefix.

## Consequences

**Made easier.** A breaking change can ship as `/api/v2` alongside `/api/v1`, and old
clients keep working until they are updated. Nothing has to be coordinated across a
deployment boundary.

Health checks are reachable regardless of API version, which is what infrastructure
expects: a load balancer probing `/health` should not need to know or care which version
the application is on.

**Made harder.** Running two versions at once means two sets of handlers to maintain, and
a discipline about when v1 is finally retired. That cost only arrives if a breaking
change is actually needed.

The version lives in the path rather than in the client's configuration, so pointing the
client at a different version is a code change, not a setting.

## Alternatives considered

**No versioning.** Fine while there is one client that deploys with the server. It stops
being fine the moment a browser tab can be older than the server, which is immediately.

**Version in a header** (`Accept: application/vnd.cubecoach.v1+json`). More
"correct" by REST purism, and genuinely better for content negotiation. Rejected because
it is invisible in logs, harder to test by hand with curl, and impossible to open in a
browser. The path is legible to everyone who touches the system.

**Version per endpoint** rather than globally. Finer-grained and avoids bumping the whole
API for one change. Rejected as more bookkeeping than a single-client project can justify.
