-- Track which CheckIn submission a user is actively answering in Slack DM.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "focusedSubmissionId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_focusedSubmissionId_key"
ON "User"("focusedSubmissionId");

ALTER TABLE "User"
ADD CONSTRAINT "User_focusedSubmissionId_fkey"
FOREIGN KEY ("focusedSubmissionId") REFERENCES "StandupSubmission"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
