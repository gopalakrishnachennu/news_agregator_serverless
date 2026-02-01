-- Migration: Translation fields + Trend metrics + Cluster article counts

-- 1) Translation controls on sources
ALTER TABLE sources
ADD COLUMN IF NOT EXISTS should_translate BOOLEAN DEFAULT FALSE;

-- 2) Translation metadata on articles
ALTER TABLE articles
ADD COLUMN IF NOT EXISTS language VARCHAR(16),
ADD COLUMN IF NOT EXISTS original_title TEXT,
ADD COLUMN IF NOT EXISTS original_snippet TEXT;

-- 3) Trend analytics fields on clusters
ALTER TABLE clusters
ADD COLUMN IF NOT EXISTS trend_slope FLOAT DEFAULT 0,
ADD COLUMN IF NOT EXISTS predicted_growth FLOAT DEFAULT 0,
ADD COLUMN IF NOT EXISTS article_count INT DEFAULT 0;

-- 4) Backfill cluster article counts
UPDATE clusters c
SET article_count = sub.cnt
FROM (
    SELECT cluster_id, COUNT(*)::int AS cnt
    FROM articles
    WHERE cluster_id IS NOT NULL
    GROUP BY cluster_id
) AS sub
WHERE c.id = sub.cluster_id;

-- 5) Maintain article_count automatically
CREATE OR REPLACE FUNCTION clusters_article_count_trigger() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.cluster_id IS NOT NULL THEN
            UPDATE clusters
            SET article_count = article_count + 1,
                last_updated_at = NOW()
            WHERE id = NEW.cluster_id;
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.cluster_id IS NOT NULL THEN
            UPDATE clusters
            SET article_count = GREATEST(article_count - 1, 0)
            WHERE id = OLD.cluster_id;
        END IF;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.cluster_id IS DISTINCT FROM OLD.cluster_id THEN
            IF OLD.cluster_id IS NOT NULL THEN
                UPDATE clusters
                SET article_count = GREATEST(article_count - 1, 0)
                WHERE id = OLD.cluster_id;
            END IF;
            IF NEW.cluster_id IS NOT NULL THEN
                UPDATE clusters
                SET article_count = article_count + 1,
                    last_updated_at = NOW()
                WHERE id = NEW.cluster_id;
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clusters_article_count_trigger ON articles;
CREATE TRIGGER clusters_article_count_trigger
AFTER INSERT OR DELETE OR UPDATE OF cluster_id ON articles
FOR EACH ROW
EXECUTE PROCEDURE clusters_article_count_trigger();
