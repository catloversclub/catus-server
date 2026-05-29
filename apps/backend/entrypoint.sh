#!/bin/sh
set -e

echo "⏳ Running Prisma migrate deploy..."
until nc -z postgres 5432; do echo "waiting for postgres..."; sleep 2; done
pnpm dlx prisma@6.17.1 migrate deploy --schema ./prisma/schema.prisma

if [ "${MOCK_SEED_ON_START:-false}" = "true" ]; then
  echo "🌱 Running production mock seed..."
  pnpm run db:seed:mock:prod
fi

echo "🚀 Starting NestJS API..."
exec node dist/src/main.js
