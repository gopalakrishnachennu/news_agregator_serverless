package db

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/jackc/pgx/v4/pgxpool"
)

type DB struct {
	Pool *pgxpool.Pool
}

type Feed struct {
	ID        int
	SourceID  int
	URL       string
	Type      string
	Config    json.RawMessage
	LastFetch *time.Time
	FetchIntervalMinutes int
}

type FeedConfig struct {
	Selector    string   `json:"selector"`
	URLPattern  string   `json:"url_pattern"`
	DenyPattern string   `json:"deny_pattern"`
	MaxDepth    int      `json:"max_depth"`
}

func New(connString string) (*DB, error) {
	pool, err := pgxpool.Connect(context.Background(), connString)
	if err != nil {
		return nil, err
	}
	return &DB{Pool: pool}, nil
}

func (d *DB) Close() {
	d.Pool.Close()
}

func (d *DB) GetPendingFeeds() ([]Feed, error) {
	query := `
		SELECT id, source_id, url, type, COALESCE(config, '{}'), last_fetched_at, COALESCE(fetch_interval_minutes, 10)
		FROM feeds
		WHERE type IN ('sitemap', 'html_section')
		AND (
			last_fetched_at IS NULL OR
			last_fetched_at + (COALESCE(fetch_interval_minutes, 10) || ' minutes')::interval < NOW()
		)
	`
	rows, err := d.Pool.Query(context.Background(), query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var feeds []Feed
	for rows.Next() {
		var f Feed
		if err := rows.Scan(&f.ID, &f.SourceID, &f.URL, &f.Type, &f.Config, &f.LastFetch, &f.FetchIntervalMinutes); err != nil {
			log.Printf("Error scanning feed: %v", err)
			continue
		}
		feeds = append(feeds, f)
	}
	return feeds, nil
}

func (d *DB) UpdateLastFetched(feedID int) error {
	_, err := d.Pool.Exec(context.Background(), "UPDATE feeds SET last_fetched_at = NOW() WHERE id = $1", feedID)
	return err
}
