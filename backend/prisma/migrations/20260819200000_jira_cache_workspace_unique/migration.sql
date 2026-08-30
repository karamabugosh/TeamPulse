-- Workspace-scoped Jira issue cache: one active row per (workspaceId, issueKey).
-- Previously unique on (userId, issueKey), which created N duplicates per issue
-- when N users synced the same workspace board.

ALTER TABLE "JiraIssueCacheEntry" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

UPDATE "JiraIssueCacheEntry" AS c
SET "workspaceId" = u."workspaceId"
FROM "User" AS u
WHERE c."userId" = u."id"
  AND (c."workspaceId" IS NULL OR c."workspaceId" = '');

DELETE FROM "JiraIssueCacheEntry" WHERE "workspaceId" IS NULL;

-- Keep freshest row per (workspaceId, issueKey); delete stale duplicates.
DELETE FROM "JiraIssueCacheEntry" AS a
USING "JiraIssueCacheEntry" AS b
WHERE a."workspaceId" = b."workspaceId"
  AND UPPER(a."issueKey") = UPPER(b."issueKey")
  AND (
    a."refreshedAt" < b."refreshedAt"
    OR (a."refreshedAt" = b."refreshedAt" AND a."id" < b."id")
  );

ALTER TABLE "JiraIssueCacheEntry" ALTER COLUMN "workspaceId" SET NOT NULL;

DROP INDEX IF EXISTS "JiraIssueCacheEntry_userId_issueKey_key";
DROP INDEX IF EXISTS "JiraIssueCacheEntry_userId_summary_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "JiraIssueCacheEntry_workspaceId_issueKey_key"
  ON "JiraIssueCacheEntry"("workspaceId", "issueKey");

CREATE INDEX IF NOT EXISTS "JiraIssueCacheEntry_workspaceId_idx"
  ON "JiraIssueCacheEntry"("workspaceId");

CREATE INDEX IF NOT EXISTS "JiraIssueCacheEntry_workspaceId_summary_idx"
  ON "JiraIssueCacheEntry"("workspaceId", "summary");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JiraIssueCacheEntry_workspaceId_fkey'
  ) THEN
    ALTER TABLE "JiraIssueCacheEntry"
      ADD CONSTRAINT "JiraIssueCacheEntry_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
