-- ChatUpload: proof of who minted a chat attachment path. sendMessage verifies
-- ownership; deleteMessage only unlinks files the deleter owns (or admin).
CREATE TABLE IF NOT EXISTS "ChatUpload" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatUpload_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChatUpload_path_key" ON "ChatUpload"("path");
CREATE INDEX IF NOT EXISTS "ChatUpload_userId_idx" ON "ChatUpload"("userId");
-- No ADD CONSTRAINT IF NOT EXISTS in Postgres — the repo DO$$ guard.
DO $$ BEGIN
  ALTER TABLE "ChatUpload" ADD CONSTRAINT "ChatUpload_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
