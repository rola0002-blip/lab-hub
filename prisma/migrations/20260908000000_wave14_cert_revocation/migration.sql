-- v0.28 (feedback wave 14): certification revocation ledger + training-record
-- revocation. Hand-written + purely additive / idempotent (the 20260825000000 template).

-- W14-A: a training record can be ANNULLED by an equipment manager with a reason.
-- Nullable trio (the v0.15 additive-NULLABLE posture — a pre-0.28 binary never
-- writes them, so no rollback DEFAULT). revokedAt NULL = active. People FK RESTRICT
-- (the wave-12 posture). No index: per-row reads go by id (Message.pinnedAt precedent).
ALTER TABLE "TrainingRecord" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);
ALTER TABLE "TrainingRecord" ADD COLUMN IF NOT EXISTS "revokedById" TEXT;
ALTER TABLE "TrainingRecord" ADD COLUMN IF NOT EXISTS "revokeReason" TEXT;
DO $$ BEGIN
  ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_revokedById_fkey"
    FOREIGN KEY ("revokedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- W14-A: the audit ledger for certification revocations. Written ONLY when a cert
-- row is actually deleted (deleteMany count = 1) — an idempotent second revoke
-- appends nothing. userId/revokedById RESTRICT (the RaAcknowledgment compliance
-- posture); equipmentId CASCADEs (the Certification posture — the audit dies with
-- the instrument). revokedTrainingRecordId is a PLAIN STRING, never an FK (the
-- RaAcknowledgment.documentId posture: an audit record must never be blocked or
-- cascaded away by its referent). No unique (revoke → re-grant → revoke appends),
-- no index (lab scale; listed via full scan take 100).
CREATE TABLE IF NOT EXISTS "CertificationRevocation" (
    "id"                       TEXT NOT NULL,
    "userId"                   TEXT NOT NULL,
    "equipmentId"              TEXT NOT NULL,
    "revokedById"              TEXT NOT NULL,
    "reason"                   TEXT NOT NULL,
    "revokedAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedTrainingRecordId"  TEXT,
    CONSTRAINT "CertificationRevocation_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "CertificationRevocation" ADD CONSTRAINT "CertificationRevocation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CertificationRevocation" ADD CONSTRAINT "CertificationRevocation_equipmentId_fkey"
    FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CertificationRevocation" ADD CONSTRAINT "CertificationRevocation_revokedById_fkey"
    FOREIGN KEY ("revokedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
