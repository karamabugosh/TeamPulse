-- AlterEnum
ALTER TYPE "QuestionType" ADD VALUE 'ISSUE_REF';

-- Migrate JiraConnection from workspace-scoped to user-scoped
ALTER TABLE "JiraConnection" ADD COLUMN "userId" TEXT;

UPDATE "JiraConnection" jc
SET "userId" = (
  SELECT u.id
  FROM "User" u
  WHERE u."workspaceId" = jc."workspaceId"
  ORDER BY u."createdAt" ASC
  LIMIT 1
)
WHERE jc."userId" IS NULL;

DELETE FROM "JiraConnection" WHERE "userId" IS NULL;

DROP INDEX IF EXISTS "JiraConnection_workspaceId_key";

ALTER TABLE "JiraConnection" ALTER COLUMN "userId" SET NOT NULL;

CREATE UNIQUE INDEX "JiraConnection_userId_key" ON "JiraConnection"("userId");
CREATE INDEX "JiraConnection_workspaceId_idx" ON "JiraConnection"("workspaceId");

ALTER TABLE "JiraConnection" ADD CONSTRAINT "JiraConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable JiraIssueCacheEntry
CREATE TABLE "JiraIssueCacheEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT,
    "projectKey" TEXT,
    "projectName" TEXT,
    "issueType" TEXT,
    "priority" TEXT,
    "issueUrl" TEXT,
    "assigneeAccountId" TEXT,
    "assigneeName" TEXT,
    "jiraUpdatedAt" TIMESTAMP(3),
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JiraIssueCacheEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JiraIssueCacheEntry_userId_issueKey_key" ON "JiraIssueCacheEntry"("userId", "issueKey");
CREATE INDEX "JiraIssueCacheEntry_userId_idx" ON "JiraIssueCacheEntry"("userId");
CREATE INDEX "JiraIssueCacheEntry_userId_summary_idx" ON "JiraIssueCacheEntry"("userId", "summary");

ALTER TABLE "JiraIssueCacheEntry" ADD CONSTRAINT "JiraIssueCacheEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable PulseBlocker
CREATE TABLE "PulseBlocker" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "checkInId" TEXT,
    "runId" TEXT,
    "submissionId" TEXT,
    "answerId" TEXT,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "dependency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "linkedIssueKey" TEXT,
    "linkedIssueId" TEXT,
    "linkedIssueUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PulseBlocker_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PulseBlocker_userId_idx" ON "PulseBlocker"("userId");
CREATE INDEX "PulseBlocker_status_idx" ON "PulseBlocker"("status");
CREATE INDEX "PulseBlocker_teamId_idx" ON "PulseBlocker"("teamId");
CREATE INDEX "PulseBlocker_runId_idx" ON "PulseBlocker"("runId");

ALTER TABLE "PulseBlocker" ADD CONSTRAINT "PulseBlocker_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable JiraProposedAction
CREATE TABLE "JiraProposedAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "blockerId" TEXT,
    "actionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "jiraIssueKey" TEXT,
    "slackChannelId" TEXT,
    "slackMessageTs" TEXT,
    "slackInteractionTs" TEXT,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "result" JSONB,
    "errorMessage" TEXT,
    CONSTRAINT "JiraProposedAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JiraProposedAction_idempotencyKey_key" ON "JiraProposedAction"("idempotencyKey");
CREATE INDEX "JiraProposedAction_userId_idx" ON "JiraProposedAction"("userId");
CREATE INDEX "JiraProposedAction_status_idx" ON "JiraProposedAction"("status");
CREATE INDEX "JiraProposedAction_blockerId_idx" ON "JiraProposedAction"("blockerId");

ALTER TABLE "JiraProposedAction" ADD CONSTRAINT "JiraProposedAction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JiraProposedAction" ADD CONSTRAINT "JiraProposedAction_blockerId_fkey"
  FOREIGN KEY ("blockerId") REFERENCES "PulseBlocker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable JiraAuditLog
CREATE TABLE "JiraAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "proposedActionId" TEXT,
    "actionType" TEXT NOT NULL,
    "jiraIssueKey" TEXT,
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JiraAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JiraAuditLog_userId_idx" ON "JiraAuditLog"("userId");
CREATE INDEX "JiraAuditLog_proposedActionId_idx" ON "JiraAuditLog"("proposedActionId");
CREATE INDEX "JiraAuditLog_createdAt_idx" ON "JiraAuditLog"("createdAt");

ALTER TABLE "JiraAuditLog" ADD CONSTRAINT "JiraAuditLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JiraAuditLog" ADD CONSTRAINT "JiraAuditLog_proposedActionId_fkey"
  FOREIGN KEY ("proposedActionId") REFERENCES "JiraProposedAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
