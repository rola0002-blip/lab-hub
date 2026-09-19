-- v0.32 Task 6: certification training requests. An uncertified member asks the
-- managers of an instrument for training; one OPEN (PENDING) request per
-- user+instrument (partial unique index — the Label posture: Prisma cannot
-- express it, so it lives here only). status is a CHECK-constrained plain TEXT
-- column, not a Prisma enum (the Notification.type / IssueActivity.type posture).
-- Hand-written + purely additive / idempotent (the 20260908000000 template).
CREATE TABLE IF NOT EXISTS "TrainingRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainingRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrainingRequest_status_check" CHECK ("status" IN ('PENDING','GRANTED','DECLINED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrainingRequest_pending_unique"
  ON "TrainingRequest"("userId","equipmentId") WHERE "status" = 'PENDING';
DO $$ BEGIN
  ALTER TABLE "TrainingRequest" ADD CONSTRAINT "TrainingRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrainingRequest" ADD CONSTRAINT "TrainingRequest_equipmentId_fkey"
    FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrainingRequest" ADD CONSTRAINT "TrainingRequest_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
