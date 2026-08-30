-- AI Phase 1: conversation history metadata
ALTER TABLE "AiConversation" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "AiConversation" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "AiConversation" ADD COLUMN IF NOT EXISTS "preview" TEXT;

CREATE INDEX IF NOT EXISTS "AiConversation_workspaceId_updatedAt_idx"
  ON "AiConversation"("workspaceId", "updatedAt");

CREATE INDEX IF NOT EXISTS "AiConversation_userId_idx"
  ON "AiConversation"("userId");
