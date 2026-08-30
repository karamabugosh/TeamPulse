-- Distinguish questions removed from CheckIn config (retired, kept for Answers)
-- from questions temporarily disabled in the active configuration.
ALTER TABLE "Question" ADD COLUMN "retiredAt" TIMESTAMP(3);

CREATE INDEX "Question_checkInId_retiredAt_idx" ON "Question"("checkInId", "retiredAt");

-- Backfill: inactive questions with a CheckIn were archived by prior sync saves.
UPDATE "Question"
SET "retiredAt" = "updatedAt"
WHERE "isActive" = false
  AND "checkInId" IS NOT NULL
  AND "retiredAt" IS NULL;
