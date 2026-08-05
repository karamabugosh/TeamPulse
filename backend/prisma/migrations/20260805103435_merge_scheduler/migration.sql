-- AlterTable
ALTER TABLE "Answer" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "AiDigest_runId_idx" ON "AiDigest"("runId");

-- AddForeignKey
ALTER TABLE "AiDigest" ADD CONSTRAINT "AiDigest_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StandupRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
