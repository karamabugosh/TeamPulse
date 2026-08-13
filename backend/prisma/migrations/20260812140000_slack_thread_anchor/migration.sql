-- Persist Slack root message anchor and permalink on each Check-In run
ALTER TABLE "StandupRun" ADD COLUMN IF NOT EXISTS "slackRootMessageTs" TEXT;
ALTER TABLE "StandupRun" ADD COLUMN IF NOT EXISTS "slackThreadUrl" TEXT;

-- Backfill root message ts from existing thread anchors
UPDATE "StandupRun"
SET "slackRootMessageTs" = "slackThreadTs"
WHERE "slackThreadTs" IS NOT NULL
  AND "slackRootMessageTs" IS NULL;
