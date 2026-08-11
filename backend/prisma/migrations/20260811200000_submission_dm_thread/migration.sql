ALTER TABLE "StandupSubmission" ADD COLUMN IF NOT EXISTS "slackDmThreadTs" TEXT;

CREATE INDEX IF NOT EXISTS "StandupSubmission_slackDmThreadTs_idx"
ON "StandupSubmission"("slackDmThreadTs");
