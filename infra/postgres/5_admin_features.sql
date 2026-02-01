-- Migration: Admin Power Features
-- 1. Blocked Keywords (Blacklist)
CREATE TABLE blocked_keywords (
    id SERIAL PRIMARY KEY,
    keyword TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup during ingestion
CREATE INDEX idx_blocked_keywords_keyword ON blocked_keywords(keyword);

-- Seed some example blocked words
INSERT INTO blocked_keywords (keyword) VALUES 
('casino'),
('lottery'),
('viagra');
