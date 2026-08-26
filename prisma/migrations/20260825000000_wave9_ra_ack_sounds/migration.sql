-- v0.23 (feedback wave 9): RaAcknowledgment table + notification-sounds default ON.
-- Hand-written + purely additive / idempotent (the 20260806000000_feedback template):
-- Postgres has no CREATE TABLE/ADD CONSTRAINT IF NOT EXISTS for every object, so
-- guards wrap what needs them and the whole file is re-runnable by hand.

-- 1. W9-B: students' risk-assessment read receipts. documentId is a PLAIN STRING
--    (NOT an FK) and documentName a snapshot: the record is compliance evidence
--    and must survive document deletion (the User.lastConversationId non-FK
--    precedent). userId RESTRICTs like Feedback.authorId (the record fails
--    loudly, never silently erases).
CREATE TABLE IF NOT EXISTS "RaAcknowledgment" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "documentId"   TEXT NOT NULL,
    "documentName" TEXT NOT NULL,
    "matricNumber" TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RaAcknowledgment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RaAcknowledgment_userId_documentId_key"
  ON "RaAcknowledgment"("userId", "documentId");
CREATE INDEX IF NOT EXISTS "RaAcknowledgment_createdAt_idx" ON "RaAcknowledgment"("createdAt");

DO $$ BEGIN
  ALTER TABLE "RaAcknowledgment" ADD CONSTRAINT "RaAcknowledgment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. W9-D (settled D6): sounds default ON for everyone. Flip the column default
--    AND every existing row (explicit opt-outs are re-enabled; they can re-disable
--    in profile). Per-device localStorage '0' still wins locally. Idempotent.
ALTER TABLE "user" ALTER COLUMN "soundsEnabled" SET DEFAULT true;
UPDATE "user" SET "soundsEnabled" = true;
