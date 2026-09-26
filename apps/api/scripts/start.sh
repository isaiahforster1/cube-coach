#!/bin/sh
# Migrate, then serve. The container's entry point; see the Dockerfile for why migrations
# run here rather than as a separate release step.
set -eu

# Migrations create and alter tables, so they may use a more privileged role than the
# application. MIGRATION_DATABASE_URL is that role's connection string; without it, the
# application's own is used, which is how a single-role deployment keeps working.
#
# The variable is set for the prisma command alone, as a prefix, rather than exported.
# `migrate deploy` only applies migrations that already exist, never generates one and
# never prompts. If it fails, `set -e` stops here and nothing is served against a schema
# the code does not understand.
DATABASE_URL="${MIGRATION_DATABASE_URL:-$DATABASE_URL}" ./node_modules/.bin/prisma migrate deploy

# The server never needs the privileged connection, so it does not inherit it. If the
# application were ever tricked into running arbitrary SQL, the most it could do is what
# its own role allows.
unset MIGRATION_DATABASE_URL

exec node dist/server.js
