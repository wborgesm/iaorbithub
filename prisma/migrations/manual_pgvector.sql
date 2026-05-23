CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS "MemoryVector" (
  "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "siteId"    TEXT,
  "sessionId" TEXT,
  "type"      TEXT NOT NULL,
  "content"   TEXT NOT NULL,
  "embedding" vector(1536),
  "metadata"  JSONB
);
CREATE INDEX IF NOT EXISTS idx_memory_vector_site ON "MemoryVector"("siteId");
CREATE INDEX IF NOT EXISTS idx_memory_vector_embedding ON "MemoryVector" 
  USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
