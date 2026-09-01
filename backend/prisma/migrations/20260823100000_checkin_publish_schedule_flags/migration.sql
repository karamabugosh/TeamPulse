-- CheckIn.publishStatus and CheckIn.scheduleEnabled exist in schema.prisma and are
-- queried at startup by SchedulerService.registerCheckInJobs(), but were never added
-- in a prior migration (local dev may have received them via db push).

ALTER TABLE "CheckIn" ADD COLUMN IF NOT EXISTS "publishStatus" TEXT NOT NULL DEFAULT 'published';
ALTER TABLE "CheckIn" ADD COLUMN IF NOT EXISTS "scheduleEnabled" BOOLEAN NOT NULL DEFAULT true;
