package database

import (
	"database/sql"
	"time"
)

type Feed struct {
	ID          int
	SourceID    int
	URL         string
	Type        string
	LastFetched *time.Time
	FetchIntervalMinutes int
}

type Repo struct {
	db *sql.DB
}

func NewRepo(db *sql.DB) *Repo {
	return &Repo{db: db}
}

func (r *Repo) GetActiveFeeds() ([]Feed, error) {
	rows, err := r.db.Query(`
		SELECT id, source_id, url, type, last_fetched_at, COALESCE(fetch_interval_minutes, 10)
		FROM feeds
		WHERE source_id IN (SELECT id FROM sources WHERE is_active = TRUE)
		AND (
			last_fetched_at IS NULL OR
			last_fetched_at + (COALESCE(fetch_interval_minutes, 10) || ' minutes')::interval < NOW()
		)
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var feeds []Feed
	for rows.Next() {
		var f Feed
		var lastFetched sql.NullTime
		if err := rows.Scan(&f.ID, &f.SourceID, &f.URL, &f.Type, &lastFetched, &f.FetchIntervalMinutes); err != nil {
			return nil, err
		}
		if lastFetched.Valid {
			f.LastFetched = &lastFetched.Time
		}
		feeds = append(feeds, f)
	}
	return feeds, nil
}

func (r *Repo) UpdateLastFetched(feedID int) error {
	_, err := r.db.Exec("UPDATE feeds SET last_fetched_at = NOW() WHERE id = $1", feedID)
	return err
}
