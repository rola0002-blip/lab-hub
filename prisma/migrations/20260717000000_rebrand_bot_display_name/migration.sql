-- Rebrand: the system bot's DISPLAY name and the #lab-updates topic follow the
-- workspace rename COLOSSUS -> LabHub. Hand-written + PURELY additive (repo rule):
-- no schema change at all, only two data UPDATEs.
--
-- The stable ids ('colossus-bot', 'colossus-lab-updates') and the bot's
-- 'bot@colossus.local' email are DELIBERATELY UNTOUCHED — they key the seeded rows,
-- every ConversationMember, and every message the bot has ever posted. This corrects
-- the display strings seeded by 20260713000000_sp5_calendar_bot_policy, which is
-- applied and sealed and must never be edited.
--
-- Both UPDATEs are guarded on the OLD value: re-running is a no-op (0 rows matched),
-- and an operator who already renamed the bot by hand keeps their choice.
--
-- Fresh-DB path: 20260713000000 INSERTs 'COLOSSUS Bot', then this migration UPDATEs it
-- to 'LabHub Bot' within the same `migrate deploy` run.

-- 1. The bot's display name (surfaced via /api/chat/users -> DM name + DM header).
--    The "user" table has no default on updatedAt, so supply it.
UPDATE "user"
   SET "name" = 'LabHub Bot', "updatedAt" = CURRENT_TIMESTAMP
 WHERE "id" = 'colossus-bot' AND "name" = 'COLOSSUS Bot';

-- 2. The visible #lab-updates channel topic.
UPDATE "Conversation"
   SET "topic" = 'Lab activity from the LabHub Bot'
 WHERE "id" = 'colossus-lab-updates' AND "topic" = 'Lab activity from the COLOSSUS Bot';
