-- SP5 Files follow-up: fix filename FTS tokenization (Task 13 reviewer finding).
-- Postgres's `english` parser lexes a filename like `graphene-transfer-protocol.pdf`,
-- `Boron_Nitride_CVD.docx`, or `X-SOP.pdf` as a SINGLE token, so tsvector search over
-- the raw name misses component-word queries ("protocol", "CVD", "SOP") entirely.
-- Redefine the Document.search generated column to normalize dots/underscores/hyphens
-- to spaces BEFORE to_tsvector, so each component word tokenizes individually, and
-- re-create the GIN index.
--
-- The column was added earlier in THIS unreleased wave (20260713000100); it is a
-- generated tsvector holding no production data, so this deterministic drop + re-add
-- is a hand-written change consistent with the repo's no-autogen migration rule.
-- prisma/schema.prisma is unchanged (search stays Unsupported("tsvector"), SQL-only).
-- The searchDocuments service applies the SAME regexp_replace to the query string in
-- JS, so a hyphenated query still matches the normalized column.

DROP INDEX "Document_search_idx";
ALTER TABLE "Document" DROP COLUMN "search";
ALTER TABLE "Document"
  ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(regexp_replace("name", '[._\-]', ' ', 'g'), ''))) STORED;
CREATE INDEX "Document_search_idx" ON "Document" USING GIN ("search");
