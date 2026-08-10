/*
  V2 Check-In Architecture Migration

  This migration:
  - adds configurable CheckIns
  - adds CheckIn participants
  - adds structured question types
  - adds InboundEvent idempotency support
  - links StandupRun to CheckIn
  - changes ConversationState from user-scoped to submission-scoped
  - safely backfills legacy ConversationState rows before enforcing NOT NULL
*/

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM (
  'FREE_TEXT',
  'YES_NO',
  'YES_NO_MAYBE',
  'MULTIPLE_CHOICE',
  'SCALE_1_5'
);

-- DropForeignKey
ALTER TABLE "ConversationState"
DROP CONSTRAINT "ConversationState_submissionId_fkey";

-- DropIndex
DROP INDEX "ConversationState_userId_key";

-- DropIndex
DROP INDEX "StandupRun_teamId_scheduledFor_key";

-- AlterTable
ALTER TABLE "Answer"
ADD COLUMN "structuredValue" JSONB;

-- Backfill legacy ConversationState rows
-- using the user's latest StandupSubmission.
UPDATE "ConversationState" AS cs
SET "submissionId" = (
  SELECT ss."id"
  FROM "StandupSubmission" AS ss
  WHERE ss."userId" = cs."userId"
  ORDER BY ss."createdAt" DESC
  LIMIT 1
)
WHERE cs."submissionId" IS NULL
AND EXISTS (
  SELECT 1
  FROM "StandupSubmission" AS ss
  WHERE ss."userId" = cs."userId"
);

-- Remove any legacy ConversationState rows that still
-- cannot be associated with a StandupSubmission.
DELETE FROM "ConversationState"
WHERE "submissionId" IS NULL;

-- ConversationState is now submission-scoped.
ALTER TABLE "ConversationState"
ALTER COLUMN "submissionId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Question"
ADD COLUMN "checkInId" TEXT,
ADD COLUMN "isRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "options" JSONB,
ADD COLUMN "type" "QuestionType" NOT NULL DEFAULT 'FREE_TEXT';

-- AlterTable
ALTER TABLE "StandupRun"
ADD COLUMN "checkInId" TEXT,
ADD COLUMN "triggerSource" TEXT NOT NULL DEFAULT 'scheduler';

-- CreateTable
CREATE TABLE "CheckIn" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "timezone" TEXT NOT NULL,
  "collectionCron" TEXT NOT NULL,
  "reminderEnabled" BOOLEAN NOT NULL DEFAULT true,
  "reminderMinutesAfter" INTEGER NOT NULL DEFAULT 30,
  "reportCron" TEXT,
  "reportChannelId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInParticipant" (
  "id" TEXT NOT NULL,
  "checkInId" TEXT NOT NULL,
  "teamMemberId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CheckInParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEvent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'slack',
  "idempotencyKey" TEXT NOT NULL,
  "externalEventId" TEXT,
  "eventType" TEXT NOT NULL,
  "payloadHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'received',
  "errorMessage" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),

  CONSTRAINT "InboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckIn_teamId_idx"
ON "CheckIn"("teamId");

-- CreateIndex
CREATE INDEX "CheckIn_enabled_idx"
ON "CheckIn"("enabled");

-- CreateIndex
CREATE INDEX "CheckInParticipant_checkInId_idx"
ON "CheckInParticipant"("checkInId");

-- CreateIndex
CREATE INDEX "CheckInParticipant_teamMemberId_idx"
ON "CheckInParticipant"("teamMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckInParticipant_checkInId_teamMemberId_key"
ON "CheckInParticipant"("checkInId", "teamMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEvent_idempotencyKey_key"
ON "InboundEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InboundEvent_workspaceId_idx"
ON "InboundEvent"("workspaceId");

-- CreateIndex
CREATE INDEX "InboundEvent_externalEventId_idx"
ON "InboundEvent"("externalEventId");

-- CreateIndex
CREATE INDEX "InboundEvent_status_idx"
ON "InboundEvent"("status");

-- CreateIndex
CREATE INDEX "InboundEvent_receivedAt_idx"
ON "InboundEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "ConversationState_userId_idx"
ON "ConversationState"("userId");

-- CreateIndex
CREATE INDEX "ConversationState_currentQuestionId_idx"
ON "ConversationState"("currentQuestionId");

-- CreateIndex
CREATE INDEX "Question_checkInId_idx"
ON "Question"("checkInId");

-- CreateIndex
CREATE INDEX "Question_isActive_idx"
ON "Question"("isActive");

-- CreateIndex
CREATE INDEX "StandupRun_checkInId_idx"
ON "StandupRun"("checkInId");

-- CreateIndex
CREATE UNIQUE INDEX "StandupRun_checkInId_scheduledFor_key"
ON "StandupRun"("checkInId", "scheduledFor");

-- CreateIndex
CREATE INDEX "Team_workspaceId_idx"
ON "Team"("workspaceId");

-- AddForeignKey
ALTER TABLE "CheckIn"
ADD CONSTRAINT "CheckIn_teamId_fkey"
FOREIGN KEY ("teamId")
REFERENCES "Team"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInParticipant"
ADD CONSTRAINT "CheckInParticipant_checkInId_fkey"
FOREIGN KEY ("checkInId")
REFERENCES "CheckIn"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInParticipant"
ADD CONSTRAINT "CheckInParticipant_teamMemberId_fkey"
FOREIGN KEY ("teamMemberId")
REFERENCES "TeamMember"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question"
ADD CONSTRAINT "Question_checkInId_fkey"
FOREIGN KEY ("checkInId")
REFERENCES "CheckIn"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandupRun"
ADD CONSTRAINT "StandupRun_checkInId_fkey"
FOREIGN KEY ("checkInId")
REFERENCES "CheckIn"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationState"
ADD CONSTRAINT "ConversationState_submissionId_fkey"
FOREIGN KEY ("submissionId")
REFERENCES "StandupSubmission"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationState"
ADD CONSTRAINT "ConversationState_currentQuestionId_fkey"
FOREIGN KEY ("currentQuestionId")
REFERENCES "Question"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEvent"
ADD CONSTRAINT "InboundEvent_workspaceId_fkey"
FOREIGN KEY ("workspaceId")
REFERENCES "Workspace"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;