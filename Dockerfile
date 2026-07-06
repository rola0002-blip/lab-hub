# syntax=docker/dockerfile:1

# ---- deps: install with a clean, reproducible lockfile ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---- prod-deps: production-only dependency tree for the runtime image.
#      Gives `prisma migrate deploy` its complete transitive closure (the
#      Prisma 7 CLI needs @prisma/config -> effect and friends, which the
#      Next standalone trace does not include). --ignore-scripts is safe:
#      the generated client is overlaid from the build stage below. ----
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---- build: generate the Prisma client (WASM query compiler + driver adapter)
#      then build the Next.js standalone output ----
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma.config.ts (Prisma 7) resolves DATABASE_URL eagerly, and Next's
# build-time page-data collection imports src/lib/env.ts whose zod schema
# requires these — placeholders only; real values come from compose at runtime.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV BETTER_AUTH_SECRET=build-placeholder-not-a-real-secret-0123456789
RUN npx prisma generate && npm run build

# ---- runtime: standalone server + full production node_modules so that
#      `prisma migrate deploy` works at container start ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Next.js standalone output (server.js + traced modules), static assets, public.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Migrations + Prisma 7 config (datasource URL + migrations path live here).
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
# Complete production dependency tree (supersedes the standalone trace),
# overlaid with the generated client + WASM query compiler from the build.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
EXPOSE 3000
# Apply pending migrations, then start the standalone server. The CLI is
# invoked by its entry file directly: no node_modules/.bin lookup needed.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
