-- SP5: additive columns for the COLOSSUS Bot, calendar-sync tokens, and the issue
-- due-soon ping — plus the one-time seed of the bot user, the #lab-updates channel,
-- and its memberships. Hand-written + PURELY additive: the Message.search /
-- Issue.search generated columns and issue_number_seq make `prisma migrate dev`
-- autogen report false drift, so migrations stay hand-written (repo rule). Every
-- INSERT is ON CONFLICT DO NOTHING → idempotent / re-runnable on the shared DB.

-- 1. isSystem flag (the bot is the only true row)
ALTER TABLE "user" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- 2. per-user calendar feed token (nullable-unique → many NULLs coexist)
ALTER TABLE "user" ADD COLUMN "icsToken" TEXT;
CREATE UNIQUE INDEX "user_icsToken_key" ON "user"("icsToken");

-- 3. issue due-soon ping bookkeeping
ALTER TABLE "Issue" ADD COLUMN "dueSoonPingedAt" TIMESTAMP(3);

-- 4a. Seed the COLOSSUS Bot user. Fixed id (matches src/features/bot). No Account
-- row is created → email+password sign-in is impossible. Direct SQL never fires
-- better-auth's databaseHooks (those wrap better-auth's adapter, not raw SQL), so
-- the invitation gate is bypassed exactly as intended. banned=false is REQUIRED:
-- getOrCreateDm filters participants by banned:false. The "user" table has no
-- default on updatedAt, so supply it.
INSERT INTO "user" ("id","name","email","emailVerified","role","banned","isSystem","createdAt","updatedAt")
VALUES ('colossus-bot','COLOSSUS Bot','bot@colossus.local',true,'member',false,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- 4b. Seed the public #lab-updates channel. Fixed id; created by the bot.
INSERT INTO "Conversation" ("id","type","name","topic","isPrivate","createdById","createdAt")
VALUES ('colossus-lab-updates','CHANNEL','lab-updates','Lab activity from the COLOSSUS Bot',false,'colossus-bot',CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- 4c. Bot membership, then every existing non-system user. Opaque uuid PKs.
INSERT INTO "ConversationMember" ("id","conversationId","userId")
VALUES (gen_random_uuid()::text,'colossus-lab-updates','colossus-bot')
ON CONFLICT ("conversationId","userId") DO NOTHING;

INSERT INTO "ConversationMember" ("id","conversationId","userId")
SELECT gen_random_uuid()::text, 'colossus-lab-updates', "id" FROM "user" WHERE "isSystem" = false
ON CONFLICT ("conversationId","userId") DO NOTHING;
