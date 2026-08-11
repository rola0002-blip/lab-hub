-- v0.15 §5.1: a project may point at ONE shared Files folder. Additive and fully
-- guarded (the hand-written idiom every SP4+ migration follows): the column is
-- NULLABLE, so — unlike v0.12's `rank` — no rollback DEFAULT is needed; a
-- pre-0.15 binary simply never writes it.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "documentFolderId" TEXT;

CREATE INDEX IF NOT EXISTS "Project_documentFolderId_idx" ON "Project"("documentFolderId");

-- NO unique constraint: a shared "Protocols" folder may back several projects.
-- ON DELETE SET NULL — deleting the folder detaches every project that pointed at
-- it (the Files service only deletes EMPTY folders, so nothing is lost silently).
DO $$ BEGIN
  ALTER TABLE "Project" ADD CONSTRAINT "Project_documentFolderId_fkey"
    FOREIGN KEY ("documentFolderId") REFERENCES "DocumentFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
