-- AlterTable
ALTER TABLE "StandupRun" ADD COLUMN     "reminderDueAt" TIMESTAMP(3),
ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "StandupRun_reminderDueAt_idx" ON "StandupRun"("reminderDueAt");

-- CreateIndex
CREATE INDEX "StandupRun_reminderSentAt_idx" ON "StandupRun"("reminderSentAt");
