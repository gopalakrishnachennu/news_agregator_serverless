-- Migration: Web Ingestion Support
-- 1. Add 'config' column for scraper rules
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS config JSONB;

-- 2. Update 'type' constraint to include 'html_section' and 'sitemap'
-- Postgres doesn't allow easy modification of CHECK constraints, so we drop and recreate.
ALTER TABLE feeds DROP CONSTRAINT IF EXISTS feeds_type_check;
ALTER TABLE feeds ADD CONSTRAINT feeds_type_check CHECK (type IN ('rss', 'atom', 'sitemap', 'sitemap_news', 'sitemap_general', 'html_section'));
