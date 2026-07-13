-- SP5 sub-feature D (Files): two additive models for the shared document library.
-- Hand-written + PURELY additive: the Document.search generated tsvector makes
-- `prisma migrate dev` autogen report false drift (exactly like Issue.search), so
-- migrations stay hand-written (repo rule). FK behaviour mirrors IssueAttachment.

CREATE TABLE "DocumentFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentFolder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentFolder_name_key" ON "DocumentFolder"("name");

CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "folderId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Document_folderId_idx" ON "Document"("folderId");

-- FTS generated column over the filename (the Issue-FTS recipe narrowed to `name`)
-- + GIN index. Kept in SQL only → the migration is hand-written, as for Issue.search.
ALTER TABLE "Document"
  ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("name", ''))) STORED;
CREATE INDEX "Document_search_idx" ON "Document" USING GIN ("search");

-- FKs mirror IssueAttachment: creator/uploader CASCADE, folder SET NULL (null = root).
ALTER TABLE "DocumentFolder" ADD CONSTRAINT "DocumentFolder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DocumentFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
