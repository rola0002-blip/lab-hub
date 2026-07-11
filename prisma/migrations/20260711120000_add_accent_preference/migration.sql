-- AlterTable: additive, nullable per-user accent preference (an accent slug from
-- src/lib/accents.ts). Applied SSR when the device's localStorage is empty
-- (localStorage wins on the device — see AccentSync). Hand-written to stay PURELY
-- additive: `prisma migrate dev` autogenerates spurious drift against the raw FTS
-- "Message.search" tsvector generated column (not modeled in schema.prisma), so
-- that drift is intentionally omitted here.
ALTER TABLE "user" ADD COLUMN "accentPreference" TEXT;
