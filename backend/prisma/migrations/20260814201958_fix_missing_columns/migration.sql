/*
  Warnings:

  - Made the column `content` on table `StandupThreadUpdate` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "AiDigest_runId_idx";

-- DropIndex
DROP INDEX "StandupRun_slackThreadTs_idx";

-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN     "publishStatus" TEXT NOT NULL DEFAULT 'published',
ADD COLUMN     "scheduleEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "StandupSubmission" ADD COLUMN     "slackDmChannelId" TEXT;

-- AlterTable
ALTER TABLE "StandupThreadUpdate" ALTER COLUMN "content" SET NOT NULL;

-- CreateIndex
CREATE INDEX "StandupThreadUpdate_submissionId_idx" ON "StandupThreadUpdate"("submissionId");
