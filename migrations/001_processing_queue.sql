CREATE TABLE IF NOT EXISTS processing_queue (
    id BIGSERIAL PRIMARY KEY,
    url TEXT UNIQUE NOT NULL,
    source_id INT REFERENCES sources(id) ON DELETE SET NULL,
    feed_id INT REFERENCES feeds(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    leased_at TIMESTAMPTZ,
    lease_owner TEXT,
    next_retry_at TIMESTAMPTZ,
    last_error TEXT,
    published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_queue_status_created ON processing_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_queue_retry ON processing_queue(next_retry_at);
