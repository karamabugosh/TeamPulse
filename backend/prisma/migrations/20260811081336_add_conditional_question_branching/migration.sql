-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "dependsOnQuestionId" TEXT,
ADD COLUMN     "showWhenAnswers" JSONB;

-- CreateIndex
CREATE INDEX "Question_dependsOnQuestionId_idx" ON "Question"("dependsOnQuestionId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_dependsOnQuestionId_fkey" FOREIGN KEY ("dependsOnQuestionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;
