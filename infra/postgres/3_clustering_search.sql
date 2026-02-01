-- Migration: Clustering and Search
-- 1. Enable pg_trgm for similarity matching (Clustering)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Indexes for Similarity Search (Clustering)
-- Allows fast: WHERE title % 'Current Article Title'
CREATE INDEX IF NOT EXISTS idx_clusters_title_trgm ON clusters USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_articles_title_trgm ON articles USING GIN (title gin_trgm_ops);

-- 3. Full-Text Search Setup (Search Bar)
-- Add tsvector column for high-performance search
ALTER TABLE articles ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Update existing rows
UPDATE articles SET search_vector = to_tsvector('english', title || ' ' || COALESCE(snippet, ''));
UPDATE clusters SET search_vector = to_tsvector('english', title);

-- Index for FTS
CREATE INDEX IF NOT EXISTS idx_articles_search ON articles USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_clusters_search ON clusters USING GIN (search_vector);

-- Trigger to keep search_vector updated
CREATE OR REPLACE FUNCTION articles_tsvector_trigger() RETURNS trigger AS $$
BEGIN
  new.search_vector := to_tsvector('english', new.title || ' ' || COALESCE(new.snippet, ''));
  RETURN new;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER tsvectorupdate BEFORE INSERT OR UPDATE
ON articles FOR EACH ROW EXECUTE PROCEDURE articles_tsvector_trigger();

CREATE OR REPLACE FUNCTION clusters_tsvector_trigger() RETURNS trigger AS $$
BEGIN
  new.search_vector := to_tsvector('english', new.title);
  RETURN new;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER tsvectorupdate BEFORE INSERT OR UPDATE
ON clusters FOR EACH ROW EXECUTE PROCEDURE clusters_tsvector_trigger();
