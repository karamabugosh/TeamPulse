-- Persist answer confidence on conversation messages (Phase 2 polish).
ALTER TABLE "AiConversationMessage" ADD COLUMN IF NOT EXISTS "confidence" TEXT;

-- Optional pgvector support (Phase 5).
-- If the host Postgres does not ship the vector extension binaries, these
-- statements fail gracefully at runtime detection — do NOT hard-fail migrate.
-- Applications detect pgvector and create embedding_vec + ANN index themselves
-- when CREATE EXTENSION succeeds. JSON "embedding" remains the portable store.

-- No-op marker so Prisma records this migration even when pgvector is absent.
SELECT 1;
