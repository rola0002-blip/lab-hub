-- v0.17 (spec 2026-08-19-labhub-feedback-wave4): message pinning + conversation
-- favorites. Both additive; favorite is a metadata-only NOT NULL DEFAULT (a
-- rolled-back binary INSERTs fine). No indexes (see schema comments).
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3);
ALTER TABLE "ConversationMember" ADD COLUMN IF NOT EXISTS "favorite" BOOLEAN NOT NULL DEFAULT false;
