-- File versioning: every Document gets a linear version history. Existing rows
-- backfill to v1 (same path/name/mime/size, uploader = original uploader).
CREATE TABLE IF NOT EXISTS "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId","version");
CREATE INDEX IF NOT EXISTS "DocumentVersion_documentId_idx" ON "DocumentVersion"("documentId");
-- No ADD CONSTRAINT IF NOT EXISTS in Postgres — the repo DO$$ guard. NOTE: the
-- User table is @@map("user") — lowercase, quoted (see 20260806000000_feedback).
DO $$ BEGIN
  ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "latestVersion" INTEGER NOT NULL DEFAULT 1;

-- Backfill (idempotent): one v1 row per Document lacking any version row.
INSERT INTO "DocumentVersion" ("id", "documentId", "version", "path", "name", "mime", "size", "uploadedById", "createdAt")
SELECT 'dv_' || "id", "id", 1, "path", "name", "mime", "size", "uploaderId", "createdAt"
FROM "Document" d
WHERE NOT EXISTS (SELECT 1 FROM "DocumentVersion" v WHERE v."documentId" = d."id");
