-- SlackMemberCache: directory cache for Live Slack users.list (AI + admin)
CREATE TABLE IF NOT EXISTS "SlackMemberCache" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slackUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "realName" TEXT,
    "email" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlackMemberCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SlackMemberCache_workspaceId_slackUserId_key"
  ON "SlackMemberCache"("workspaceId", "slackUserId");

CREATE INDEX IF NOT EXISTS "SlackMemberCache_workspaceId_idx"
  ON "SlackMemberCache"("workspaceId");

CREATE INDEX IF NOT EXISTS "SlackMemberCache_workspaceId_isBot_deleted_idx"
  ON "SlackMemberCache"("workspaceId", "isBot", "deleted");

CREATE INDEX IF NOT EXISTS "SlackMemberCache_displayName_idx"
  ON "SlackMemberCache"("displayName");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SlackMemberCache_workspaceId_fkey'
  ) THEN
    ALTER TABLE "SlackMemberCache"
      ADD CONSTRAINT "SlackMemberCache_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
