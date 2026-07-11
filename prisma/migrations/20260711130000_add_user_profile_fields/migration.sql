-- AlterTable: additive, nullable user profile fields — `title` (free-text
-- role/title shown under the name on the People page) and `timezone` (IANA tz id
-- driving the member's rendered local time). Hand-written to stay PURELY additive
-- (the raw FTS "Message.search" generated column makes `prisma migrate dev`
-- autogenerate spurious drift, omitted here).
ALTER TABLE "user" ADD COLUMN "title" TEXT;
ALTER TABLE "user" ADD COLUMN "timezone" TEXT;
