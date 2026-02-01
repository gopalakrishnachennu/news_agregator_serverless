-- Add sentiment and virality columns to articles
ALTER TABLE articles 
ADD COLUMN IF NOT EXISTS sentiment_score FLOAT DEFAULT 0,
ADD COLUMN IF NOT EXISTS sentiment_label VARCHAR(50) DEFAULT 'NEUTRAL',
ADD COLUMN IF NOT EXISTS virality_score INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS emotion_tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS sentiment_processed_at TIMESTAMPTZ;

-- Create index for fast filtering of viral content
CREATE INDEX IF NOT EXISTS idx_articles_virality ON articles(virality_score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_sentiment ON articles(sentiment_label);
