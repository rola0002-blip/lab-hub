-- AddColumn: additive Message.kind ('user' | 'system'). System rows are chat
-- event lines ("Roland created this channel", "Wei joined #general") that render
-- centered/muted and MUST NOT count as unread or trigger notifications.
--
-- Hand-written to stay PURELY additive. `prisma migrate dev` autogenerates
-- spurious drift that drops and recreates the raw FTS "Message.search" generated
-- column (a tsvector not modeled in schema.prisma), which fails with 42601. That
-- drift is intentionally omitted here so this migration only adds the column.
ALTER TABLE "Message" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'user';
