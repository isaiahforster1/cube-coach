# One image serves the whole application: the API under /api/v1 and the built web
# client everywhere else. See docs/architecture/0017-one-origin-in-production.md.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
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
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
# The Prisma client is generated from the schema rather than committed, so it has to be
# built here as well as installed.
RUN pnpm --filter @cube-coach/api db:generate
RUN pnpm --filter @cube-coach/web build

FROM base AS runtime
ENV NODE_ENV=production
# Listening on loopback would make the container unreachable from outside itself, which
# presents as a platform health check that never passes and no error anywhere.
ENV HOST=0.0.0.0

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
# Only the built client, not its source or its dependencies.
COPY --from=build /app/apps/web/dist ./apps/web/dist

# Not root. A container escape is a great deal less interesting from an account that owns
# nothing.
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/api
CMD ["node", "--experimental-strip-types", "src/server.ts"]
