-- Slack AI assistant request logs
CREATE TABLE IF NOT EXISTS "SlackAiChatLog" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "slackUserId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "threadTs" TEXT,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "sources" JSONB,
  "confidence" TEXT,
  "intent" TEXT,
  "conversationId" TEXT,
  "responseTimeMs" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SlackAiChatLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SlackAiChatLog_workspaceId_idx" ON "SlackAiChatLog"("workspaceId");
CREATE INDEX IF NOT EXISTS "SlackAiChatLog_userId_idx" ON "SlackAiChatLog"("userId");
CREATE INDEX IF NOT EXISTS "SlackAiChatLog_slackUserId_idx" ON "SlackAiChatLog"("slackUserId");
CREATE INDEX IF NOT EXISTS "SlackAiChatLog_createdAt_idx" ON "SlackAiChatLog"("createdAt");

ALTER TABLE "SlackAiChatLog"
  ADD CONSTRAINT "SlackAiChatLog_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SlackAiChatLog"
  ADD CONSTRAINT "SlackAiChatLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
