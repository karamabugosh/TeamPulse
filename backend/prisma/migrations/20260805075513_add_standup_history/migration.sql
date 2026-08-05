/*
  Warnings:

  - A unique constraint covering the columns `[submissionId]` on the table `ConversationState` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Team` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Answer" ADD COLUMN     "submissionId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ConversationState" ADD COLUMN     "submissionId" TEXT;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "schedulerEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "StandupRun" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'collecting',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandupRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandupSubmission" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandupSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StandupRun_teamId_idx" ON "StandupRun"("teamId");

-- CreateIndex
CREATE INDEX "StandupRun_status_idx" ON "StandupRun"("status");

-- CreateIndex
CREATE INDEX "StandupRun_scheduledFor_idx" ON "StandupRun"("scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "StandupRun_teamId_scheduledFor_key" ON "StandupRun"("teamId", "scheduledFor");

-- CreateIndex
CREATE INDEX "StandupSubmission_runId_idx" ON "StandupSubmission"("runId");

-- CreateIndex
CREATE INDEX "StandupSubmission_userId_idx" ON "StandupSubmission"("userId");

-- CreateIndex
CREATE INDEX "StandupSubmission_status_idx" ON "StandupSubmission"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StandupSubmission_runId_userId_key" ON "StandupSubmission"("runId", "userId");

-- CreateIndex
CREATE INDEX "Answer_userId_idx" ON "Answer"("userId");

-- CreateIndex
CREATE INDEX "Answer_questionId_idx" ON "Answer"("questionId");

-- CreateIndex
CREATE INDEX "Answer_submissionId_idx" ON "Answer"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationState_submissionId_key" ON "ConversationState"("submissionId");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- AddForeignKey
ALTER TABLE "StandupRun" ADD CONSTRAINT "StandupRun_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandupSubmission" ADD CONSTRAINT "StandupSubmission_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StandupRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandupSubmission" ADD CONSTRAINT "StandupSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "StandupSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationState" ADD CONSTRAINT "ConversationState_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "StandupSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
