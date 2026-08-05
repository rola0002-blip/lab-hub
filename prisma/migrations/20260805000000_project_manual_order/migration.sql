-- v0.12 (manual project arrangement): Project.rank — a base-62 fractional index
-- (src/features/issues/rank.ts), COLLATE "C" so Postgres byte-orders it exactly as
-- the TypeScript string compare does. Lowest key = front of the /projects grid.
-- Hand-written + PURELY additive (repo rule: `prisma migrate dev` autogen reports
-- false drift on the generated tsvector columns and issue_number_seq). Every
-- statement is guarded, so the whole file is idempotent / re-runnable by hand.

-- 1. Nullable first: existing rows need a backfill before NOT NULL can hold.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "rank" TEXT COLLATE "C";

-- 2. Backfill: pre-existing projects keep the order they were already displayed in
--    (newest first), mapped onto evenly-spaced two-character base-62 keys so later
--    inserts have room on both sides. The markers below are load-bearing — the
--    integration suite slices this block out of the file and re-runs it against
--    deliberately re-nulled rows (tests/integration/project-list.test.ts).
-- BACKFILL-START
DO $$
DECLARE
  digits CONSTANT TEXT := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  n INTEGER;
  step INTEGER;
  i INTEGER;
  r RECORD;
BEGIN
  SELECT count(*) INTO n FROM "Project" WHERE "rank" IS NULL;
  IF n = 0 THEN RETURN; END IF;
  -- 61 * 62 = 3782 distinct two-char keys whose second digit is never '0'. The lab
  -- has tens of projects, not thousands; if that ever stops being true this must
  -- fail loudly rather than silently collide.
  IF n > 3000 THEN
    RAISE EXCEPTION 'Project.rank backfill: % unranked rows exceeds the two-character keyspace budget (3000)', n;
  END IF;
  step := 3782 / (n + 1); -- integer division; >= 1 for every n <= 3000
  FOR r IN
    SELECT "id", row_number() OVER (ORDER BY "createdAt" DESC, "id" ASC) AS rn
      FROM "Project" WHERE "rank" IS NULL
  LOOP
    -- Strictly increasing in i, hence strictly increasing in rn: a higher i either
    -- raises the first digit or (same first digit) raises the second. substr() is
    -- 1-based, and the second digit starts at position 2, so no key ends in '0' —
    -- the rank.ts invariant that makes lexicographic order equal fraction order.
    i := r.rn * step;
    UPDATE "Project"
       SET "rank" = substr(digits, (i / 61) + 1, 1) || substr(digits, (i % 61) + 2, 1)
     WHERE "id" = r.id;
  END LOOP;
END $$;
-- BACKFILL-END

-- 3. Now enforceable, and safe on re-run: step 2 leaves no NULLs behind.
ALTER TABLE "Project" ALTER COLUMN "rank" SET NOT NULL;

-- 4. The grid's only ordering read.
CREATE INDEX IF NOT EXISTS "Project_rank_idx" ON "Project"("rank");
