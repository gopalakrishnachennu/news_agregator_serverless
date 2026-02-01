-- Enable the vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to clusters table
-- 384 dimensions matches all-MiniLM-L6-v2
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS embedding vector(384);

-- Create an HNSW index for fast similarity search
-- cosine distance operator is <=>
CREATE INDEX IF NOT EXISTS idx_clusters_embedding ON clusters USING hnsw (embedding vector_cosine_ops);
