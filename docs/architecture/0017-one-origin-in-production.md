# ADR-0017: The API serves the web client, from one origin

## Status

Accepted — 2026-09-19

## Context

Until now the two halves have run separately: Vite on port 5173, the API on port 3000,
with CORS configured to let them talk. That is normal for development and it is a
decision waiting to be made for production, where the obvious shape is a static host for
the client and a separate service for the API.

It is also a trap, because of the session cookie.

[ADR-0006](0006-session-cookies-not-jwt.md) chose a database-backed session cookie, set
`httpOnly` and `sameSite: 'lax'`. `sameSite: 'lax'` means the browser attaches it to
same-site requests and to top-level navigations, and to nothing else — so a client on
`app.example.com` calling an API on `api.example.com` would be silently signed out on
every request. Not an error: just no cookie, and a 401.

The usual fix is `sameSite: 'none'`, which reinstates exactly the cross-site request
forgery that `lax` was preventing and buys a deployment topology nobody asked for.

## Decision

In production, one process serves both. The API registers the built client as static
files, answers unmatched page requests with `index.html`, and keeps `/api/v1` and
`/health` for itself.

In development, Vite proxies `/api` through to the API's own port, so the browser sees a
single origin there too. The client's base URL is therefore relative — `/api/v1` — in
both.

## Why the development proxy matters as much as the production setup

It would have been enough to serve one origin in production and leave development as it
was. That is how this class of bug gets shipped: the difference between the two
environments is exactly the thing that breaks, so the environment you test in is the one
that cannot show you.

With the proxy, a cookie problem, a CORS problem or a relative-path problem shows up on a
laptop rather than after a deploy.

## Consequences

**CORS stops being load-bearing.** The configuration stays, because development can still
be run without the proxy and the tests cover it, but nothing in production depends on
getting it right.

**The OAuth callback comes back to the same place the user left.** One redirect URI, one
origin, no cookie crossing a site boundary at the moment it is being set.

**One thing to deploy.** A single container serves the pages and the API, which for an
application of this size is simpler to reason about, cheaper, and removes a class of
"which of the two is down?" questions.

**Static assets are served by Node rather than a CDN.** They are cached and fingerprinted,
and at this scale the difference is not worth a second deployment target. If it ever is, a
CDN in front of the whole origin keeps everything above true.

**The not-found handler is shared.** Fastify allows one per instance, and both the API's
404 and the client's app shell want it, so they cooperate explicitly rather than one
quietly overwriting the other. An unknown `/api/v1/...` still returns a JSON 404 — serving
HTML there would turn a typo into a parse error somewhere far away.

## What this cost, and what it caught

Building the client and running it behind the production configuration — before deploying
anything — found three faults that development could not have shown:

1. The client's API base URL defaulted to `http://localhost:3000`, which is correct for a
   developer and wrong for every user.
2. The content security policy blocked the scramble solver's worker. `worker-src` falls
   back to `script-src` when it is not set, and the solver starts from a `data:` URL.
3. Even with the worker allowed, the built bundle fails to instantiate it. That one is
   still open — see the note in `docs/deployment.md` — and is why the scramble provider
   now falls back to move-based scrambles and says so, rather than leaving the timer
   waiting for a scramble that will never come.

None of the three would have appeared before the first deploy.

## Alternatives considered

**Static host plus a separate API**, with `sameSite: 'none'`. The conventional split, and
it means every request carries a cookie the browser will also attach to requests made by
other sites. CSRF protection would have to be built back on top.

**Static host with a proxy rewrite** — Netlify or Cloudflare forwarding `/api/*` to the API
service. This keeps one origin from the browser's point of view and is a good answer. It
was not chosen because it puts the routing rule in a platform's configuration file rather
than in this repository, where it can be tested.

**Serving the client from a CDN and the API from a subdomain of the same site**, with the
cookie scoped to the parent domain. Works, needs a real domain to develop against, and
makes the local setup harder rather than easier.
