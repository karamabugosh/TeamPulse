-- Rename dashboard auth table to AdminUser and align columns with JWT auth model.
ALTER TABLE "DashboardAccount" RENAME TO "AdminUser";

ALTER TABLE "AdminUser" RENAME COLUMN "passwordHash" TO "password";

ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'admin';
