# One image serves the whole application: the API under /api/v1 and the built web
# client everywhere else. See docs/architecture/0017-one-origin-in-production.md.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Prisma's engines link against OpenSSL and the slim image does not carry it, so Prisma
# guesses a version and warns on every command. Installing it is a few megabytes and
# removes a warning that otherwise sits in the logs looking like a real problem.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Dependencies change far less often than source, so they are installed from the
# manifests alone. Copying the whole tree first would invalidate this layer on every
# edit and turn a ten-second rebuild into a two-minute one.
FROM base AS dependencies
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# The API's postinstall generates the Prisma client, which needs the schema — so the
# schema has to be here before the install runs, not after it with the rest of the
# source. It changes about as often as the dependencies do, so the layer still caches.
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
# The Prisma client is generated from the schema rather than committed, so it has to be
# built here as well as installed.
RUN pnpm --filter @cube-coach/api db:generate
RUN pnpm --filter @cube-coach/web build
# The API is bundled to a single JavaScript file. Node can strip types from a .ts file
# but does not rewrite the .js import specifiers TypeScript requires, so the source
# cannot simply be run — and bundling also inlines the shared package, which is source
# rather than a published build.
RUN pnpm --filter @cube-coach/api build

# Everything is built, so the build tools can go. This is most of the image: test
# runners, bundlers and type definitions that no running server ever loads.
RUN pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production
# Listening on loopback would make the container unreachable from outside itself, which
# presents as a platform health check that never passes and no error anywhere.
ENV HOST=0.0.0.0

# pnpm does not flatten dependencies. Each workspace package gets its own node_modules
# of symlinks pointing into the root store, so copying only the root leaves every import
# unresolvable — the bundle asks for `@fastify/cookie` and there is no link to follow.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
# Kept for `db:deploy`, which applies migrations as part of a release.
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
# Only the built client, not its source or its dependencies.
COPY --from=build /app/apps/web/dist ./apps/web/dist

# Not root. A container escape is a great deal less interesting from an account that owns
# nothing.
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/api

# Migrate, then serve.
#
# The alternative is a separate release step, which is what you want once there are
# several instances and a deploy has to be zero-downtime: migrations run once, then the
# new containers start. Here there is one container, and putting it in the image means
# the release does not depend on a setting in a hosting dashboard that may be named
# something different next month.
#
# `migrate deploy` only applies migrations that already exist, never generates one and
# never prompts. If it fails the container exits rather than serving against a schema it
# does not understand — which is the right way round: a deploy that stops is a problem
# you find, and one that serves half-migrated is a problem your users find.
#
# Concurrent starts are safe: Prisma takes an advisory lock, so a second container waits
# rather than applying the same migration twice.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node dist/server.js"]
