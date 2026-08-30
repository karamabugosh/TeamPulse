-- Pulse V2 Phase 3A — MemoryChunk full-text retrieval index
-- Safe additive migration: no data rewrite, no embedding changes, no pgvector requirement.
-- Expression GIN index for to_tsvector('english', text).

CREATE INDEX IF NOT EXISTS "MemoryChunk_text_fts_gin_idx"
ON "MemoryChunk"
USING gin (to_tsvector('english', coalesce(text, '')));
