-- Keep only the latest digest per standup run before enforcing uniqueness.
DELETE FROM "AiDigest" AS older
USING "AiDigest" AS newer
WHERE older."runId" = newer."runId"
  AND older."generatedAt" < newer."generatedAt";

ALTER TABLE "AiDigest" ADD COLUMN IF NOT EXISTS "slackReportText" TEXT;
ALTER TABLE "AiDigest" ADD COLUMN IF NOT EXISTS "nonResponderNames" JSONB;
ALTER TABLE "AiDigest" ADD COLUMN IF NOT EXISTS "slackReportBlocks" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "AiDigest_runId_key" ON "AiDigest"("runId");
