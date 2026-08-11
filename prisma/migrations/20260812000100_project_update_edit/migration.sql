-- v0.15 §6.1: an author may correct or retract their own project update. Two
-- NULLABLE timestamps mirroring Message.editedAt/deletedAt (and IssueComment's) —
-- the delete is SOFT, so the lab's narrative history is never erased (the same
-- reason ProjectUpdate.authorId is onDelete Restrict). Additive and guarded, the
-- hand-written idiom every SP4+ migration follows; a pre-0.15 binary rolled back
-- onto this schema simply never writes either column.
ALTER TABLE "ProjectUpdate" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);
ALTER TABLE "ProjectUpdate" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
