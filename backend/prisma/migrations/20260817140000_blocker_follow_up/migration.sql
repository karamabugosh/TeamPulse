-- AlterTable PulseBlocker
ALTER TABLE "PulseBlocker" ADD COLUMN IF NOT EXISTS "resolutionNotes" TEXT;
ALTER TABLE "PulseBlocker" ADD COLUMN IF NOT EXISTS "resolutionType" TEXT;
ALTER TABLE "PulseBlocker" ADD COLUMN IF NOT EXISTS "needsHelp" BOOLEAN;
ALTER TABLE "PulseBlocker" ADD COLUMN IF NOT EXISTS "needsEscalation" BOOLEAN;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PulseBlockerUpdate" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "notes" TEXT,
    "resolutionType" TEXT,
    "needsHelp" BOOLEAN,
    "needsEscalation" BOOLEAN,
    "daysOpen" INTEGER,
    "updatedFrom" TEXT NOT NULL DEFAULT 'Slack Follow-up',

    CONSTRAINT "PulseBlockerUpdate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PulseBlockerUpdate_blockerId_idx" ON "PulseBlockerUpdate"("blockerId");
CREATE INDEX IF NOT EXISTS "PulseBlockerUpdate_userId_idx" ON "PulseBlockerUpdate"("userId");
CREATE INDEX IF NOT EXISTS "PulseBlockerUpdate_createdAt_idx" ON "PulseBlockerUpdate"("createdAt");

ALTER TABLE "PulseBlockerUpdate"
  DROP CONSTRAINT IF EXISTS "PulseBlockerUpdate_blockerId_fkey";
ALTER TABLE "PulseBlockerUpdate"
  ADD CONSTRAINT "PulseBlockerUpdate_blockerId_fkey"
  FOREIGN KEY ("blockerId") REFERENCES "PulseBlocker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PulseBlockerUpdate"
  DROP CONSTRAINT IF EXISTS "PulseBlockerUpdate_userId_fkey";
ALTER TABLE "PulseBlockerUpdate"
  ADD CONSTRAINT "PulseBlockerUpdate_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE IF NOT EXISTS "BlockerFollowUpSession" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pendingIds" JSONB NOT NULL,
    "completedIds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "channelId" TEXT,
    "threadTs" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockerFollowUpSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BlockerFollowUpSession_submissionId_key" ON "BlockerFollowUpSession"("submissionId");
CREATE INDEX IF NOT EXISTS "BlockerFollowUpSession_userId_idx" ON "BlockerFollowUpSession"("userId");
CREATE INDEX IF NOT EXISTS "BlockerFollowUpSession_status_idx" ON "BlockerFollowUpSession"("status");
