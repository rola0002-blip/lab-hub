-- Add nullable Project.startDate. Purely additive: no backfill, no default, no
-- touch to the Issue.search generated column. The start <= target ordering
-- invariant is enforced at the service layer (project-service.ts), not by a DB
-- constraint, so historical rows and null combinations stay valid.
ALTER TABLE "Project" ADD COLUMN "startDate" TIMESTAMP(3);
