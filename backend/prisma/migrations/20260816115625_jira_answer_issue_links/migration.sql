-- CreateEnum
CREATE TYPE "JiraIssueLinkSource" AS ENUM ('USER_SELECTED', 'EXPLICIT_KEY', 'AI_SUGGESTED', 'ACTIVITY_PREFILL');

-- CreateTable
CREATE TABLE "JiraAnswerIssueLink" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "jiraIntegrationId" TEXT,
    "jiraIssueId" TEXT NOT NULL,
    "jiraIssueKey" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "issueUrl" TEXT NOT NULL,
    "summarySnapshot" TEXT NOT NULL,
    "statusIdSnapshot" TEXT,
    "statusNameSnapshot" TEXT,
    "issueTypeSnapshot" TEXT,
    "source" "JiraIssueLinkSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "confirmedAt" TIMESTAMP(3),
    "selectionOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraAnswerIssueLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JiraAnswerIssueLink_answerId_selectionOrder_idx" ON "JiraAnswerIssueLink"("answerId", "selectionOrder");

-- CreateIndex
CREATE INDEX "JiraAnswerIssueLink_jiraIntegrationId_jiraIssueKey_idx" ON "JiraAnswerIssueLink"("jiraIntegrationId", "jiraIssueKey");

-- CreateIndex
CREATE INDEX "JiraAnswerIssueLink_projectKey_idx" ON "JiraAnswerIssueLink"("projectKey");

-- CreateIndex
CREATE INDEX "JiraAnswerIssueLink_jiraIssueKey_idx" ON "JiraAnswerIssueLink"("jiraIssueKey");

-- CreateIndex
CREATE INDEX "JiraAnswerIssueLink_confirmedAt_idx" ON "JiraAnswerIssueLink"("confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JiraAnswerIssueLink_answerId_jiraIntegrationId_jiraIssueId_key" ON "JiraAnswerIssueLink"("answerId", "jiraIntegrationId", "jiraIssueId");

-- AddForeignKey
ALTER TABLE "JiraAnswerIssueLink" ADD CONSTRAINT "JiraAnswerIssueLink_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraAnswerIssueLink" ADD CONSTRAINT "JiraAnswerIssueLink_jiraIntegrationId_fkey" FOREIGN KEY ("jiraIntegrationId") REFERENCES "JiraIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
