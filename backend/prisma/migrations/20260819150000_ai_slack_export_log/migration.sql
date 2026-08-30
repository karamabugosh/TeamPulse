-- AI Workspace: Send-to-Slack activity log
CREATE TABLE IF NOT EXISTS "AiSlackExportLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "slackUserId" TEXT,
    "channelId" TEXT,
    "channelName" TEXT,
    "destinationType" TEXT NOT NULL,
    "reportType" TEXT,
    "title" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "messageTs" TEXT,
    "attachments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSlackExportLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiSlackExportLog_workspaceId_idx"
  ON "AiSlackExportLog"("workspaceId");

CREATE INDEX IF NOT EXISTS "AiSlackExportLog_workspaceId_createdAt_idx"
  ON "AiSlackExportLog"("workspaceId", "createdAt");

CREATE INDEX IF NOT EXISTS "AiSlackExportLog_success_idx"
  ON "AiSlackExportLog"("success");

CREATE INDEX IF NOT EXISTS "AiSlackExportLog_createdAt_idx"
  ON "AiSlackExportLog"("createdAt");

ALTER TABLE "AiSlackExportLog"
  DROP CONSTRAINT IF EXISTS "AiSlackExportLog_workspaceId_fkey";
ALTER TABLE "AiSlackExportLog"
  ADD CONSTRAINT "AiSlackExportLog_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiSlackExportLog"
  DROP CONSTRAINT IF EXISTS "AiSlackExportLog_userId_fkey";
ALTER TABLE "AiSlackExportLog"
  ADD CONSTRAINT "AiSlackExportLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
