-- AlterTable
ALTER TABLE "PulseBlocker" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "PulseBlocker" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "PulseBlocker" ADD COLUMN IF NOT EXISTS "expectedResolution" TEXT;
ALTER TABLE "PulseBlocker" ADD COLUMN IF NOT EXISTS "preventingAllWork" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PulseBlocker" ADD COLUMN IF NOT EXISTS "ownerLabel" TEXT;

CREATE INDEX IF NOT EXISTS "PulseBlocker_createdAt_idx" ON "PulseBlocker"("createdAt");
