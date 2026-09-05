-- v0.26 (feedback wave 12): training records + booking session logging.
-- Hand-written + purely additive / idempotent (the 20260825000000 template).

-- W12-B: append-only training log. userId/trainedById RESTRICT (the RaAcknowledgment
-- compliance posture — the record fails loudly, never silently erases); equipment
-- CASCADEs (the Certification posture). NO unique constraint: revoke → re-grant
-- legitimately appends a second record. trainedOn is an org-tz yyyy-MM-dd STRING
-- (the Milestone.date convention — day-granular, no tz ambiguity).
CREATE TABLE IF NOT EXISTS "TrainingRecord" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "equipmentId"  TEXT NOT NULL,
    "trainedById"  TEXT NOT NULL,
    "trainedOn"    TEXT NOT NULL,
    "note"         TEXT NOT NULL DEFAULT '',
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainingRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TrainingRecord_userId_equipmentId_idx"
  ON "TrainingRecord"("userId", "equipmentId");
CREATE INDEX IF NOT EXISTS "TrainingRecord_equipmentId_idx"
  ON "TrainingRecord"("equipmentId");

DO $$ BEGIN
  ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_trainedById_fkey"
    FOREIGN KEY ("trainedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_equipmentId_fkey"
    FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- W12-C: usage session on Booking. Nullable timestamps (no session yet = NULL);
-- sessionNote NOT NULL DEFAULT '' (the ConversationMember.favorite rollback-safety
-- precedent — a rolled-back binary INSERTs fine, old rows backfill ''). No indexes:
-- per-row reads go by id (lab scale, the Message.pinnedAt precedent).
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "sessionStartedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "sessionEndedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "sessionNote" TEXT NOT NULL DEFAULT '';
