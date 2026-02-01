package rss

import (
	"context"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/mmcdole/gofeed"
	"github.com/news-aggregator/feed-collector/internal/database"
	"github.com/news-aggregator/feed-collector/internal/queue"
)

type Poller struct {
	repo     *database.Repo
	producer *queue.Producer
	fp       *gofeed.Parser
}

func NewPoller(repo *database.Repo, producer *queue.Producer) *Poller {
	fp := gofeed.NewParser()
	fp.Client = &http.Client{
		Timeout: 30 * time.Second,
	}
	return &Poller{
		repo:     repo,
		producer: producer,
		fp:       fp,
	}
}

func (p *Poller) Start(ctx context.Context, workers int, interval time.Duration) error {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Initial run
	p.runBatch(workers)

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			p.runBatch(workers)
		}
	}
}

func (p *Poller) runBatch(workers int) {
	feeds, err := p.repo.GetActiveFeeds()
	if err != nil {
		log.Printf("Error fetching feeds: %v", err)
		return
	}

	log.Printf("Found %d feeds to process", len(feeds))

	jobs := make(chan database.Feed, len(feeds))
	var wg sync.WaitGroup

	// Start workers
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for f := range jobs {
				p.processFeed(f)
			}
		}()
	}

	// Enqueue jobs
	for _, f := range feeds {
		jobs <- f
	}
	close(jobs)
	wg.Wait()
}

func (p *Poller) processFeed(f database.Feed) {
	log.Printf("Fetching feed: %s", f.URL)
	feed, err := p.fp.ParseURL(f.URL)
	if err != nil {
		log.Printf("Failed to parse feed %s: %v", f.URL, err)
		return
	}

	newItems := 0
	for _, item := range feed.Items {
		// Basic check: In reality, we should check Redis bloom filter here first
		// or check if published > last_fetched
		
		publishTime := item.PublishedParsed
		if publishTime == nil {
			publishTime = item.UpdatedParsed
		}
		
		// If item is older than last fetched, skip (simple optimization)
		if f.LastFetched != nil && publishTime != nil && publishTime.Before(*f.LastFetched) {
			continue
		}

		// Publish to Kafka
		if p.producer != nil {
			normalizedURL := normalizeURL(item.Link)
			if normalizedURL == "" {
				continue
			}
			err := p.producer.Publish(queue.ScrapeJob{
				URL: normalizedURL,
				SourceID: f.SourceID,
				FeedID:      f.ID,
				PublishedAt: publishTime, 
			})
			if err != nil {
				log.Printf("Failed to publish URL %s: %v", item.Link, err)
			} else {
				newItems++
			}
		}
	}

	log.Printf("Processed feed %s: %d new items", f.URL, newItems)
	p.repo.UpdateLastFetched(f.ID)
}

func normalizeURL(raw string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	if u.Scheme == "" {
		u.Scheme = "http"
	}

	// Remove tracking params
	q := u.Query()
	for key := range q {
		if len(key) >= 4 && key[:4] == "utm_" {
			q.Del(key)
		}
	}
	q.Del("fbclid")
	q.Del("gclid")
	q.Del("igshid")
	q.Del("mc_cid")
	q.Del("mc_eid")
	u.RawQuery = q.Encode()

	// Normalize AMP URLs
	if u.Hostname() != "" && len(u.Hostname()) > 4 && u.Hostname()[:4] == "amp." {
		u.Host = u.Hostname()[4:]
	}
	if u.Path != "/" {
		if len(u.Path) > 4 && u.Path[len(u.Path)-4:] == "/amp" {
			u.Path = u.Path[:len(u.Path)-4]
		}
		if len(u.Path) > 5 && u.Path[len(u.Path)-5:] == "/amp/" {
			u.Path = u.Path[:len(u.Path)-5] + "/"
		}
	}
	q = u.Query()
	if q.Has("amp") {
		q.Del("amp")
		u.RawQuery = q.Encode()
	}

	return u.String()
}
