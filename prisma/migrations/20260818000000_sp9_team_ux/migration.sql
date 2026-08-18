-- v0.16 (spec 2026-08-18-labhub-feedback-wave3): Milestone, ProjectUpdateAttachment,
-- Label.projectId + partial-unique swap (the wave's ONE flagged deviation from
-- additive-only: DROP INDEX on Label_name_key, replaced by two PARTIAL uniques that
-- together preserve exactly the old invariant — every existing row has projectId
-- NULL and lands under the global unique), three User columns, Notification.emailedAt.
-- Everything additive is guarded with IF NOT EXISTS so re-runs and old-binary
-- roll-forward are safe (the hand-written idiom every SP4+ migration follows).
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so each FK is wrapped in a
-- duplicate_object guard (sp8 idiom); PKs are inline in CREATE TABLE IF NOT EXISTS.

-- F4: milestones
CREATE TABLE IF NOT EXISTS "Milestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Milestone_projectId_idx" ON "Milestone"("projectId");
DO $$ BEGIN
  ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- F6: project-update attachments
CREATE TABLE IF NOT EXISTS "ProjectUpdateAttachment" (
    "id" TEXT NOT NULL,
    "updateId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectUpdateAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectUpdateAttachment_updateId_idx" ON "ProjectUpdateAttachment"("updateId");
DO $$ BEGIN
  ALTER TABLE "ProjectUpdateAttachment" ADD CONSTRAINT "ProjectUpdateAttachment_updateId_fkey"
    FOREIGN KEY ("updateId") REFERENCES "ProjectUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- F5: per-project labels. Existing rows keep projectId NULL → the global
-- partial unique enforces exactly what Label_name_key enforced before.
ALTER TABLE "Label" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
CREATE INDEX IF NOT EXISTS "Label_projectId_idx" ON "Label"("projectId");
DO $$ BEGIN
  ALTER TABLE "Label" ADD CONSTRAINT "Label_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DROP INDEX IF EXISTS "Label_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "label_global_name_unique" ON "Label"("name") WHERE "projectId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "label_project_scoped_name_unique" ON "Label"("name", "projectId") WHERE "projectId" IS NOT NULL;

-- F3/F7/F9: per-user workspace state
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "pinnedProjectIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "lastConversationId" TEXT;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "soundsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- F8: digest-email latch on the bell row
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "emailedAt" TIMESTAMP(3);
