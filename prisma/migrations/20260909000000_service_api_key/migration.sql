-- v0.30 (service API key): bearer keys for headless callers acting as the
-- LabHub Bot. Hand-written + purely additive / idempotent (the 20260825000000
-- template). No FK to "user": every key resolves to the fixed bot id at runtime
-- (no per-key user mapping in v1). tokenHash is sha256-hex of the full
-- `labhub_`-prefixed token — no plaintext at rest, deterministic lookup
-- (the user.icsToken nullable-unique posture, minus the nullable: a key row is
-- always born with its hash). revokedAt NULL = active (TrainingRecord.revokedAt).
CREATE TABLE IF NOT EXISTS "ServiceKey" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "tokenHash"   TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt"  TIMESTAMP(3),
    "revokedAt"   TIMESTAMP(3),
    CONSTRAINT "ServiceKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceKey_name_key" ON "ServiceKey"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceKey_tokenHash_key" ON "ServiceKey"("tokenHash");
