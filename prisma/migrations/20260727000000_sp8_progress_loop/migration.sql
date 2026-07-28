-- SP8 (progress loop): ProjectHealth enum, ProjectUpdate table, Project prompt
-- latch/snooze columns + indexes, Organization cadence columns. Hand-written +
-- PURELY additive: the three generated tsvector columns and issue_number_seq make
-- `prisma migrate dev` autogen report false drift, so migrations stay hand-written
-- (repo rule). Postgres has no ADD CONSTRAINT IF NOT EXISTS, so each FK is wrapped
-- in a duplicate_object guard — the whole file is idempotent / re-runnable by hand.

-- 1. Health enum (guarded CREATE TYPE)
DO $$ BEGIN
  CREATE TYPE "ProjectHealth" AS ENUM ('ON_TRACK','AT_RISK','OFF_TRACK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. ProjectUpdate table
CREATE TABLE IF NOT EXISTS "ProjectUpdate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "health" "ProjectHealth" NOT NULL,
    "body" TEXT NOT NULL,
    "originMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectUpdate_pkey" PRIMARY KEY ("id")
);

-- 3. Read-path index (reverse-chron per project; latest-update groupBy)
CREATE INDEX IF NOT EXISTS "ProjectUpdate_projectId_createdAt_idx" ON "ProjectUpdate"("projectId","createdAt");

-- 4. Foreign keys (guarded: no ADD CONSTRAINT IF NOT EXISTS in Postgres)
DO $$ BEGIN
  ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_originMessageId_fkey"
    FOREIGN KEY ("originMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. Project: recurring latch + snooze (both nullable — null is the meaningful initial state)
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "lastUpdatePromptAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "updatePromptsPausedUntil" TIMESTAMP(3);

-- 6. Project indexes (Project carried none; one line each, hand-written anyway)
CREATE INDEX IF NOT EXISTS "Project_status_idx" ON "Project"("status");
CREATE INDEX IF NOT EXISTS "Project_leadId_idx" ON "Project"("leadId");

-- 7. Organization cadence (NOT NULL DEFAULT backfills the single org row atomically:
--    Tuesday 16:00 org time — "the day before group meeting")
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "updatePromptDay" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "updatePromptHour" INTEGER NOT NULL DEFAULT 16;
