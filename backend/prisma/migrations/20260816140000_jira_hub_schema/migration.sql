-- Jira Hub: enrich issue links + team memory index
ALTER TABLE "AnswerJiraIssueLink" ADD COLUMN IF NOT EXISTS "runId" TEXT;
ALTER TABLE "AnswerJiraIssueLink" ADD COLUMN IF NOT EXISTS "cloudId" TEXT;

CREATE INDEX IF NOT EXISTS "AnswerJiraIssueLink_runId_idx" ON "AnswerJiraIssueLink"("runId");
CREATE INDEX IF NOT EXISTS "AnswerJiraIssueLink_issueKey_idx" ON "AnswerJiraIssueLink"("issueKey");
CREATE INDEX IF NOT EXISTS "AnswerJiraIssueLink_createdAt_idx" ON "AnswerJiraIssueLink"("createdAt");

DO $$ BEGIN
  ALTER TABLE "AnswerJiraIssueLink"
    ADD CONSTRAINT "AnswerJiraIssueLink_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "StandupRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TeamMemoryDocument" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "issueKey" TEXT,
  "runId" TEXT,
  "submissionId" TEXT,
  "metadata" JSONB,
  "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamMemoryDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TeamMemoryDocument_sourceType_sourceId_key"
  ON "TeamMemoryDocument"("sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "TeamMemoryDocument_workspaceId_idx" ON "TeamMemoryDocument"("workspaceId");
CREATE INDEX IF NOT EXISTS "TeamMemoryDocument_sourceType_idx" ON "TeamMemoryDocument"("sourceType");
CREATE INDEX IF NOT EXISTS "TeamMemoryDocument_issueKey_idx" ON "TeamMemoryDocument"("issueKey");
CREATE INDEX IF NOT EXISTS "TeamMemoryDocument_createdAt_idx" ON "TeamMemoryDocument"("createdAt");

DO $$ BEGIN
  ALTER TABLE "TeamMemoryDocument"
    ADD CONSTRAINT "TeamMemoryDocument_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Backfill runId from submissions for existing links
UPDATE "AnswerJiraIssueLink" AS link
SET "runId" = sub."runId"
FROM "StandupSubmission" AS sub
WHERE link."submissionId" = sub."id" AND link."runId" IS NULL;
