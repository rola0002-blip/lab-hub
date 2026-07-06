# syntax=docker/dockerfile:1

# ---- deps: install with a clean, reproducible lockfile ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---- build: generate the Prisma client (WASM query compiler + driver adapter)
#      then build the Next.js standalone output ----
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `prisma generate` reads prisma.config.ts (Prisma 7 moved datasource/migrations
# config out of schema.prisma). It is present via `COPY . .` above.
RUN npx prisma generate && npm run build

# ---- runtime: minimal standalone server + everything `prisma migrate deploy`
#      needs at container start ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Next.js standalone output (auto-traces @prisma/client, @prisma/adapter-pg, pg
# from src imports) plus static assets and public files.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Prisma migrate deploy needs: the CLI, the schema, the migrations, and the
# Prisma 7 config file (datasource URL + migrations path live here, not in
# schema.prisma). The generated client (.prisma/client) carries the WASM query
# compiler used at runtime — copy it explicitly so tracing gaps can't break it.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
EXPOSE 3000
# Apply pending migrations, then start the traced standalone server.
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
