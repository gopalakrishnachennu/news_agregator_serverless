-- Database Schema for News Aggregator

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Sources: Authorized publishers
CREATE TABLE sources (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    logo_url TEXT,
    trust_score FLOAT DEFAULT 0.5,
    is_active BOOLEAN DEFAULT TRUE,
    scrape_rules JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Feeds: RSS/Sitemap endpoints
CREATE TABLE feeds (
    id SERIAL PRIMARY KEY,
    source_id INT REFERENCES sources(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    type VARCHAR(50) CHECK (type IN ('rss', 'atom', 'sitemap_news', 'sitemap_general')),
    last_fetched_at TIMESTAMPTZ,
    last_modified_header TEXT,
    etag_header TEXT,
    error_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Clusters: Grouped stories
CREATE TABLE clusters (
    id BIGSERIAL PRIMARY KEY,
    primary_article_id BIGINT, -- Circular dependency handled by deferred constraint or app logic
    title TEXT,
    topic VARCHAR(50),
    score FLOAT DEFAULT 0.0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clusters_topic_score ON clusters(topic, score DESC);
CREATE INDEX idx_clusters_updated ON clusters(last_updated_at DESC);

-- 4. Articles: Individual news items
CREATE TABLE articles (
    id BIGSERIAL PRIMARY KEY,
    cluster_id BIGINT REFERENCES clusters(id) ON DELETE SET NULL,
    source_id INT REFERENCES sources(id) ON DELETE SET NULL,
    url TEXT UNIQUE NOT NULL,
    url_hash VARCHAR(64) UNIQUE, -- SHA256 of URL for faster lookups
    canonical_url TEXT,
    title TEXT NOT NULL,
    snippet TEXT,
    published_at TIMESTAMPTZ,
    author VARCHAR(255),
    
    -- Best Image metadata
    best_image_url TEXT, 
    best_image_width INT,
    best_image_height INT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_articles_cluster ON articles(cluster_id);
CREATE INDEX idx_articles_published ON articles(published_at DESC);
CREATE INDEX idx_articles_source ON articles(source_id);

-- 5. Images: Candidate images for articles
CREATE TABLE images (
    id BIGSERIAL PRIMARY KEY,
    article_id BIGINT REFERENCES articles(id) ON DELETE CASCADE,
    original_url TEXT NOT NULL,
    local_path TEXT, -- Path in S3/MinIO
    width INT,
    height INT,
    format VARCHAR(10),
    score FLOAT DEFAULT 0.0,
    reasons JSONB, -- Scoring explanation
    is_hero BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_images_article ON images(article_id);

-- 6. Seed some Initial Data
INSERT INTO sources (domain, name, trust_score) VALUES 
('nytimes.com', 'The New York Times', 0.9),
('bbc.co.uk', 'BBC News', 0.9),
('techcrunch.com', 'TechCrunch', 0.8),
('wired.com', 'Wired', 0.8),
('theverge.com', 'The Verge', 0.8);

-- Seed Feeds (Examples)
INSERT INTO feeds (source_id, url, type) 
SELECT id, 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', 'rss' FROM sources WHERE domain = 'nytimes.com';

INSERT INTO feeds (source_id, url, type)
SELECT id, 'http://feeds.bbci.co.uk/news/rss.xml', 'rss' FROM sources WHERE domain = 'bbc.co.uk';

INSERT INTO feeds (source_id, url, type)
SELECT id, 'https://techcrunch.com/feed/', 'rss' FROM sources WHERE domain = 'techcrunch.com';
