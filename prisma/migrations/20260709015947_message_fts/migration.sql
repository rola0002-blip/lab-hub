ALTER TABLE "Message"
  ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("body", ''))) STORED;

CREATE INDEX "Message_search_idx" ON "Message" USING GIN ("search");
