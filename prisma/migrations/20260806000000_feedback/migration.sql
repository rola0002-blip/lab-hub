-- v0.13 (feedback system): FeedbackType/FeedbackStatus enums + the Feedback table —
-- in-app bug reports and ideas, with the author FK RESTRICTed like ProjectUpdate's.
-- Hand-written + PURELY additive: the generated tsvector columns and issue_number_seq
-- make `prisma migrate dev` autogen report false drift, so migrations stay hand-written
-- (repo rule). Postgres has no CREATE TYPE / ADD CONSTRAINT IF NOT EXISTS, so each is
-- wrapped in a duplicate_object guard — the whole file is idempotent / re-runnable by
-- hand. New table, so no backfill and no rollback default (a rolled-back binary simply
-- never touches a table it does not know).

-- 1. Enums (guarded CREATE TYPE — the ProjectHealth precedent)
DO $$ BEGIN
  CREATE TYPE "FeedbackType" AS ENUM ('BUG','IDEA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "FeedbackStatus" AS ENUM ('NEW','REVIEWED','PLANNED','DONE','DECLINED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Feedback table
CREATE TABLE IF NOT EXISTS "Feedback" (
    "id" TEXT NOT NULL,
    "type" "FeedbackType" NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "body" TEXT NOT NULL,
    "screenshotPath" TEXT,
    "appVersion" TEXT NOT NULL,
    "pagePath" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- 3. Read-path indexes (the admin queue filters by status, newest first; "my
--    submissions" reads by author)
CREATE INDEX IF NOT EXISTS "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Feedback_authorId_createdAt_idx" ON "Feedback"("authorId", "createdAt");

-- 4. Foreign key (guarded: no ADD CONSTRAINT IF NOT EXISTS in Postgres). The user
--    table is @@map("user") — lowercase, quoted.
DO $$ BEGIN
  ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
