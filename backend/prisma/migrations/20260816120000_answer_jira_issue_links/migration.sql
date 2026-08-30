-- CreateTable
CREATE TABLE "AnswerJiraIssueLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answerId" TEXT,
    "issueId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT,
    "assigneeName" TEXT,
    "projectKey" TEXT,
    "issueUrl" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnswerJiraIssueLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnswerJiraIssueLink_submissionId_questionId_issueKey_key" ON "AnswerJiraIssueLink"("submissionId", "questionId", "issueKey");

-- CreateIndex
CREATE INDEX "AnswerJiraIssueLink_submissionId_questionId_idx" ON "AnswerJiraIssueLink"("submissionId", "questionId");

-- CreateIndex
CREATE INDEX "AnswerJiraIssueLink_answerId_idx" ON "AnswerJiraIssueLink"("answerId");

-- CreateIndex
CREATE INDEX "AnswerJiraIssueLink_userId_idx" ON "AnswerJiraIssueLink"("userId");

-- AddForeignKey
ALTER TABLE "AnswerJiraIssueLink" ADD CONSTRAINT "AnswerJiraIssueLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerJiraIssueLink" ADD CONSTRAINT "AnswerJiraIssueLink_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "StandupSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerJiraIssueLink" ADD CONSTRAINT "AnswerJiraIssueLink_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerJiraIssueLink" ADD CONSTRAINT "AnswerJiraIssueLink_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
