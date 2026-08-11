-- Report workflow: track pipeline status on runs and extended report sections
ALTER TABLE "StandupRun" ADD COLUMN IF NOT EXISTS "reportStatus" TEXT NOT NULL DEFAULT 'waiting_for_responses';
ALTER TABLE "AiDigest" ADD COLUMN IF NOT EXISTS "reportSections" JSONB;

CREATE INDEX IF NOT EXISTS "StandupRun_reportStatus_idx" ON "StandupRun"("reportStatus");
