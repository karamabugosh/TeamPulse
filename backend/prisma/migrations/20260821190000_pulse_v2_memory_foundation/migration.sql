-- Pulse V2 Phase 1: Team Memory foundation
-- Additive only: MemoryVisibility / outbox enums, MemoryChunk, MemoryOutboxEvent.
-- Does NOT drop or alter TeamMemoryDocument, KnowledgeEmbedding, Jira, or Slack tables.
-- Does NOT require backfill. Does NOT require pgvector.
-- Native embedding_vec for MemoryChunk is intentionally omitted (optional later, same
-- pattern as KnowledgeEmbedding runtime detection).

-- Enums
DO $$ BEGIN
  CREATE TYPE "MemoryVisibility" AS ENUM ('WORKSPACE', 'TEAM', 'PRIVATE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MemoryOutboxOperation" AS ENUM ('UPSERT', 'DELETE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MemoryOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- MemoryChunk (derived searchable units; multi-chunk per source)
CREATE TABLE IF NOT EXISTS "MemoryChunk" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "visibility" "MemoryVisibility" NOT NULL DEFAULT 'WORKSPACE',
    "ownerUserId" TEXT,
    "teamId" TEXT,
    "linkedIssueKey" TEXT,
    "metadata" JSONB,
    "embedding" JSONB,
    "embeddingModel" TEXT,
    "embeddingDimensions" INTEGER,
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MemoryChunk_workspaceId_sourceType_sourceId_chunkIndex_key"
  ON "MemoryChunk"("workspaceId", "sourceType", "sourceId", "chunkIndex");

CREATE INDEX IF NOT EXISTS "MemoryChunk_workspaceId_idx"
  ON "MemoryChunk"("workspaceId");

CREATE INDEX IF NOT EXISTS "MemoryChunk_workspaceId_visibility_idx"
  ON "MemoryChunk"("workspaceId", "visibility");

CREATE INDEX IF NOT EXISTS "MemoryChunk_workspaceId_sourceType_idx"
  ON "MemoryChunk"("workspaceId", "sourceType");

CREATE INDEX IF NOT EXISTS "MemoryChunk_workspaceId_linkedIssueKey_idx"
  ON "MemoryChunk"("workspaceId", "linkedIssueKey");

CREATE INDEX IF NOT EXISTS "MemoryChunk_workspaceId_teamId_idx"
  ON "MemoryChunk"("workspaceId", "teamId");

CREATE INDEX IF NOT EXISTS "MemoryChunk_workspaceId_ownerUserId_idx"
  ON "MemoryChunk"("workspaceId", "ownerUserId");

CREATE INDEX IF NOT EXISTS "MemoryChunk_sourceType_sourceId_idx"
  ON "MemoryChunk"("sourceType", "sourceId");

CREATE INDEX IF NOT EXISTS "MemoryChunk_contentHash_idx"
  ON "MemoryChunk"("contentHash");

ALTER TABLE "MemoryChunk"
  DROP CONSTRAINT IF EXISTS "MemoryChunk_workspaceId_fkey";
ALTER TABLE "MemoryChunk"
  ADD CONSTRAINT "MemoryChunk_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MemoryChunk"
  DROP CONSTRAINT IF EXISTS "MemoryChunk_ownerUserId_fkey";
ALTER TABLE "MemoryChunk"
  ADD CONSTRAINT "MemoryChunk_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MemoryChunk"
  DROP CONSTRAINT IF EXISTS "MemoryChunk_teamId_fkey";
ALTER TABLE "MemoryChunk"
  ADD CONSTRAINT "MemoryChunk_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- MemoryOutboxEvent (dedicated indexing outbox; not InboundEvent)
CREATE TABLE IF NOT EXISTS "MemoryOutboxEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "operation" "MemoryOutboxOperation" NOT NULL,
    "status" "MemoryOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryOutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MemoryOutboxEvent_status_availableAt_idx"
  ON "MemoryOutboxEvent"("status", "availableAt");

CREATE INDEX IF NOT EXISTS "MemoryOutboxEvent_workspaceId_idx"
  ON "MemoryOutboxEvent"("workspaceId");

CREATE INDEX IF NOT EXISTS "MemoryOutboxEvent_workspaceId_status_availableAt_idx"
  ON "MemoryOutboxEvent"("workspaceId", "status", "availableAt");

CREATE INDEX IF NOT EXISTS "MemoryOutboxEvent_sourceType_sourceId_idx"
  ON "MemoryOutboxEvent"("sourceType", "sourceId");

CREATE INDEX IF NOT EXISTS "MemoryOutboxEvent_workspaceId_sourceType_sourceId_idx"
  ON "MemoryOutboxEvent"("workspaceId", "sourceType", "sourceId");

ALTER TABLE "MemoryOutboxEvent"
  DROP CONSTRAINT IF EXISTS "MemoryOutboxEvent_workspaceId_fkey";
ALTER TABLE "MemoryOutboxEvent"
  ADD CONSTRAINT "MemoryOutboxEvent_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
