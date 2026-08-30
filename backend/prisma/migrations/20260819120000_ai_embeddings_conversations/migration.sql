-- AI Workspace: knowledge embeddings + persisted conversations
-- Note: pgvector is NOT available on this Postgres install
-- (CREATE EXTENSION vector fails with 0A000). Embeddings are stored
-- as JSON float arrays; cosine similarity runs in the application.

CREATE TABLE IF NOT EXISTS "KnowledgeEmbedding" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeEmbedding_workspaceId_sourceType_sourceId_key"
  ON "KnowledgeEmbedding"("workspaceId", "sourceType", "sourceId");

CREATE INDEX IF NOT EXISTS "KnowledgeEmbedding_workspaceId_idx"
  ON "KnowledgeEmbedding"("workspaceId");

CREATE INDEX IF NOT EXISTS "KnowledgeEmbedding_workspaceId_entityType_idx"
  ON "KnowledgeEmbedding"("workspaceId", "entityType");

CREATE INDEX IF NOT EXISTS "KnowledgeEmbedding_contentHash_idx"
  ON "KnowledgeEmbedding"("contentHash");

ALTER TABLE "KnowledgeEmbedding"
  DROP CONSTRAINT IF EXISTS "KnowledgeEmbedding_workspaceId_fkey";
ALTER TABLE "KnowledgeEmbedding"
  ADD CONSTRAINT "KnowledgeEmbedding_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "AiConversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "vacationPending" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiConversation_workspaceId_idx"
  ON "AiConversation"("workspaceId");

CREATE INDEX IF NOT EXISTS "AiConversation_updatedAt_idx"
  ON "AiConversation"("updatedAt");

ALTER TABLE "AiConversation"
  DROP CONSTRAINT IF EXISTS "AiConversation_workspaceId_fkey";
ALTER TABLE "AiConversation"
  ADD CONSTRAINT "AiConversation_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "AiConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "intent" TEXT,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiConversationMessage_conversationId_createdAt_idx"
  ON "AiConversationMessage"("conversationId", "createdAt");

ALTER TABLE "AiConversationMessage"
  DROP CONSTRAINT IF EXISTS "AiConversationMessage_conversationId_fkey";
ALTER TABLE "AiConversationMessage"
  ADD CONSTRAINT "AiConversationMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
