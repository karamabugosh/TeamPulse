-- CreateEnum
CREATE TYPE "JiraConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "JiraIntegrationHealth" AS ENUM ('NOT_CONFIGURED', 'HEALTHY', 'DEGRADED', 'UNAVAILABLE');

-- AlterEnum
ALTER TYPE "QuestionType" ADD VALUE 'ISSUE_REF';

-- CreateTable
CREATE TABLE "JiraIntegration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "cloudId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "siteName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "defaultProjectKey" TEXT,
    "allowedProjectKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cacheTtlMinutes" INTEGER NOT NULL DEFAULT 15,
    "health" "JiraIntegrationHealth" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamJiraConfig" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "jiraIntegrationId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "issuePickerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "activityPrefillEnabled" BOOLEAN NOT NULL DEFAULT false,
    "commentProposalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "transitionProposalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "blockerProposalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "issueLinkProposalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createIssueProposalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultProjectKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamJiraConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JiraQuestionConfig" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "allowMultiple" BOOLEAN NOT NULL DEFAULT false,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,
    "allowedProjectKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "plaintextFallbackEnabled" BOOLEAN NOT NULL DEFAULT true,
    "actionProposalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraQuestionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JiraUserConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jiraIntegrationId" TEXT NOT NULL,
    "jiraAccountId" TEXT NOT NULL,
    "jiraDisplayName" TEXT,
    "jiraEmail" TEXT,
    "accessTokenCiphertext" TEXT NOT NULL,
    "refreshTokenCiphertext" TEXT NOT NULL,
    "grantedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" "JiraConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastValidatedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraUserConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JiraIntegration_workspaceId_idx" ON "JiraIntegration"("workspaceId");

-- CreateIndex
CREATE INDEX "JiraIntegration_workspaceId_enabled_idx" ON "JiraIntegration"("workspaceId", "enabled");

-- CreateIndex
CREATE INDEX "JiraIntegration_workspaceId_isDefault_idx" ON "JiraIntegration"("workspaceId", "isDefault");

-- CreateIndex
CREATE INDEX "JiraIntegration_health_idx" ON "JiraIntegration"("health");

-- CreateIndex
CREATE UNIQUE INDEX "JiraIntegration_workspaceId_cloudId_key" ON "JiraIntegration"("workspaceId", "cloudId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamJiraConfig_teamId_key" ON "TeamJiraConfig"("teamId");

-- CreateIndex
CREATE INDEX "TeamJiraConfig_jiraIntegrationId_idx" ON "TeamJiraConfig"("jiraIntegrationId");

-- CreateIndex
CREATE INDEX "TeamJiraConfig_enabled_idx" ON "TeamJiraConfig"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "JiraQuestionConfig_questionId_key" ON "JiraQuestionConfig"("questionId");

-- CreateIndex
CREATE INDEX "JiraQuestionConfig_actionProposalEnabled_idx" ON "JiraQuestionConfig"("actionProposalEnabled");

-- CreateIndex
CREATE INDEX "JiraUserConnection_jiraIntegrationId_status_idx" ON "JiraUserConnection"("jiraIntegrationId", "status");

-- CreateIndex
CREATE INDEX "JiraUserConnection_status_idx" ON "JiraUserConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "JiraUserConnection_userId_jiraIntegrationId_key" ON "JiraUserConnection"("userId", "jiraIntegrationId");

-- CreateIndex
CREATE UNIQUE INDEX "JiraUserConnection_jiraIntegrationId_jiraAccountId_key" ON "JiraUserConnection"("jiraIntegrationId", "jiraAccountId");

-- AddForeignKey
ALTER TABLE "JiraIntegration" ADD CONSTRAINT "JiraIntegration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamJiraConfig" ADD CONSTRAINT "TeamJiraConfig_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamJiraConfig" ADD CONSTRAINT "TeamJiraConfig_jiraIntegrationId_fkey" FOREIGN KEY ("jiraIntegrationId") REFERENCES "JiraIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraQuestionConfig" ADD CONSTRAINT "JiraQuestionConfig_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraUserConnection" ADD CONSTRAINT "JiraUserConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraUserConnection" ADD CONSTRAINT "JiraUserConnection_jiraIntegrationId_fkey" FOREIGN KEY ("jiraIntegrationId") REFERENCES "JiraIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
