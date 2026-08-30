-- Denormalize workspaceId onto high-traffic activity tables so Demo and Real
-- share the same isolation pattern (direct workspace filter, not only via User).

ALTER TABLE "PulseBlocker" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "JiraAuditLog" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "AnswerJiraIssueLink" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

UPDATE "PulseBlocker" AS b
SET "workspaceId" = u."workspaceId"
FROM "User" AS u
WHERE b."userId" = u."id"
  AND (b."workspaceId" IS NULL OR b."workspaceId" = '');

UPDATE "JiraAuditLog" AS a
SET "workspaceId" = u."workspaceId"
FROM "User" AS u
WHERE a."userId" = u."id"
  AND (a."workspaceId" IS NULL OR a."workspaceId" = '');

UPDATE "AnswerJiraIssueLink" AS l
SET "workspaceId" = u."workspaceId"
FROM "User" AS u
WHERE l."userId" = u."id"
  AND (l."workspaceId" IS NULL OR l."workspaceId" = '');

DELETE FROM "PulseBlocker" WHERE "workspaceId" IS NULL;
DELETE FROM "JiraAuditLog" WHERE "workspaceId" IS NULL;
DELETE FROM "AnswerJiraIssueLink" WHERE "workspaceId" IS NULL;

ALTER TABLE "PulseBlocker" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "JiraAuditLog" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "AnswerJiraIssueLink" ALTER COLUMN "workspaceId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "PulseBlocker_workspaceId_idx" ON "PulseBlocker"("workspaceId");
CREATE INDEX IF NOT EXISTS "JiraAuditLog_workspaceId_idx" ON "JiraAuditLog"("workspaceId");
CREATE INDEX IF NOT EXISTS "AnswerJiraIssueLink_workspaceId_idx" ON "AnswerJiraIssueLink"("workspaceId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PulseBlocker_workspaceId_fkey'
  ) THEN
    ALTER TABLE "PulseBlocker"
      ADD CONSTRAINT "PulseBlocker_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JiraAuditLog_workspaceId_fkey'
  ) THEN
    ALTER TABLE "JiraAuditLog"
      ADD CONSTRAINT "JiraAuditLog_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AnswerJiraIssueLink_workspaceId_fkey'
  ) THEN
    ALTER TABLE "AnswerJiraIssueLink"
      ADD CONSTRAINT "AnswerJiraIssueLink_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
