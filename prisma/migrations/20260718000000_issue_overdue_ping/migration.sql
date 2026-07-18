-- v0.9.5: additive bookkeeping column for the OVERDUE bot nudge — the one-shot
-- sibling of "dueSoonPingedAt". Set when the overdue DM first fires; cleared by
-- setDueDate() when the due date changes (re-arms). Hand-written + PURELY additive:
-- the Issue.search generated column and issue_number_seq make `prisma migrate dev`
-- autogen report false drift, so migrations stay hand-written (repo rule). ADD
-- COLUMN IF NOT EXISTS → idempotent / re-runnable on the shared DB. No changes to
-- any sealed bot identity.
ALTER TABLE "Issue" ADD COLUMN IF NOT EXISTS "overduePingedAt" TIMESTAMP(3);
