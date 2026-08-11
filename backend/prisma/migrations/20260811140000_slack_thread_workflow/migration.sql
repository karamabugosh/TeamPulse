-- Slack thread workflow: updates channel replaces collection/report channels
ALTER TABLE "CheckIn" RENAME COLUMN "collectionChannelId" TO "updatesChannelId";
ALTER TABLE "CheckIn" DROP COLUMN IF EXISTS "reportChannelId";

ALTER TABLE "StandupRun" ADD COLUMN IF NOT EXISTS "threadReplyCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "StandupThreadUpdate" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "submissionId" TEXT,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "slackMessageTs" TEXT,
  "content" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StandupThreadUpdate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StandupThreadUpdate_runId_idx" ON "StandupThreadUpdate"("runId");
CREATE INDEX IF NOT EXISTS "StandupThreadUpdate_userId_idx" ON "StandupThreadUpdate"("userId");

DO $$ BEGIN
  ALTER TABLE "StandupThreadUpdate" ADD CONSTRAINT "StandupThreadUpdate_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "StandupRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StandupThreadUpdate" ADD CONSTRAINT "StandupThreadUpdate_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "StandupSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StandupThreadUpdate" ADD CONSTRAINT "StandupThreadUpdate_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
