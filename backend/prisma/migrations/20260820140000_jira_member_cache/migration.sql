-- JiraMemberCache: directory cache for Live Jira users/search (AI + Demo)
CREATE TABLE IF NOT EXISTS "JiraMemberCache" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "avatarUrl" TEXT,
    "accountType" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JiraMemberCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "JiraMemberCache_workspaceId_accountId_key"
  ON "JiraMemberCache"("workspaceId", "accountId");

CREATE INDEX IF NOT EXISTS "JiraMemberCache_workspaceId_idx"
  ON "JiraMemberCache"("workspaceId");

CREATE INDEX IF NOT EXISTS "JiraMemberCache_workspaceId_active_idx"
  ON "JiraMemberCache"("workspaceId", "active");

CREATE INDEX IF NOT EXISTS "JiraMemberCache_displayName_idx"
  ON "JiraMemberCache"("displayName");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JiraMemberCache_workspaceId_fkey'
  ) THEN
    ALTER TABLE "JiraMemberCache"
      ADD CONSTRAINT "JiraMemberCache_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
