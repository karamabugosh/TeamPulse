-- SlackChannel: shared table for Demo (seeded) and Real (optional sync).
-- Demo never calls the Slack API — it only inserts rows into PostgreSQL.

CREATE TABLE IF NOT EXISTS "SlackChannel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slackChannelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT,
    "purpose" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "memberCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SlackChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SlackChannel_workspaceId_slackChannelId_key"
  ON "SlackChannel"("workspaceId", "slackChannelId");

CREATE INDEX IF NOT EXISTS "SlackChannel_workspaceId_idx" ON "SlackChannel"("workspaceId");
CREATE INDEX IF NOT EXISTS "SlackChannel_name_idx" ON "SlackChannel"("name");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SlackChannel_workspaceId_fkey'
  ) THEN
    ALTER TABLE "SlackChannel"
      ADD CONSTRAINT "SlackChannel_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
