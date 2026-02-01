-- Add fetch_interval_minutes to feeds
ALTER TABLE feeds ADD COLUMN fetch_interval_minutes INT DEFAULT 10;
