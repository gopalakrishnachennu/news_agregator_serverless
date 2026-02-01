-- Fix: Enforce Unique URLs in Feeds
-- 1. Remove existing duplicates (keeping the one with the lowest ID)
DELETE FROM feeds a USING feeds b
WHERE a.id > b.id AND a.url = b.url;

-- 2. Add Unique Constraint
ALTER TABLE feeds ADD CONSTRAINT unique_feed_url UNIQUE (url);
