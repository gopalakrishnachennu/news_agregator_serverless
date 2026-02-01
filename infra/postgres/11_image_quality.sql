-- Add image quality score to articles
ALTER TABLE articles
ADD COLUMN IF NOT EXISTS image_quality_score FLOAT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_articles_image_quality ON articles(image_quality_score DESC);
