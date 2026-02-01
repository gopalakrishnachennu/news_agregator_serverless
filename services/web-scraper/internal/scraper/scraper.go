package scraper

import (
	"encoding/json"
	"log"
	"net/url"
	"regexp"
	"strings"

	"github.com/gocolly/colly/v2"
	"github.com/gopalakrishnachennu/news-aggregator/services/web-scraper/internal/db"
	"github.com/gopalakrishnachennu/news-aggregator/services/web-scraper/internal/kafka"
)

type Scraper struct {
	DB       *db.DB
	Producer *kafka.Producer
}

func New(database *db.DB, producer *kafka.Producer) *Scraper {
	return &Scraper{DB: database, Producer: producer}
}

func (s *Scraper) ProcessFeeds() error {
	feeds, err := s.DB.GetPendingFeeds()
	if err != nil {
		return err
	}

	for _, feed := range feeds {
		log.Printf("Processing feed: %s (Type: %s)", feed.URL, feed.Type)
		
		var foundURLs []string
		
		if feed.Type == "html_section" {
			foundURLs = s.scrapeHTML(feed)
		} else if feed.Type == "sitemap" {
			foundURLs = s.scrapeSitemap(feed)
		}

		if len(foundURLs) > 0 {
			log.Printf("Found %d new URLs for feed %d", len(foundURLs), feed.ID)
			if err := s.Producer.PublishURLs(foundURLs, feed.SourceID, feed.ID); err != nil {
				log.Printf("Failed to publish URLs: %v", err)
			}
		}

		s.DB.UpdateLastFetched(feed.ID)
	}
	return nil
}

func (s *Scraper) scrapeHTML(feed db.Feed) []string {
	var cfg db.FeedConfig
	if err := json.Unmarshal(feed.Config, &cfg); err != nil {
		log.Printf("Invalid config for feed %d: %v", feed.ID, err)
		return nil
	}

	if cfg.Selector == "" {
		cfg.Selector = "a" // Default to all links
	}

	c := colly.NewCollector(
		colly.UserAgent("NewsAggregator/1.0 (+http://localhost)"),
	)

	var urls []string
	c.OnHTML(cfg.Selector, func(e *colly.HTMLElement) {
		link := e.Attr("href")
		link = e.Request.AbsoluteURL(link)
		
		normalized := normalizeURL(link)
		if s.isValidURL(normalized, cfg) {
			urls = append(urls, normalized)
		}
	})

	c.Visit(feed.URL)
	return urls
}

func (s *Scraper) scrapeSitemap(feed db.Feed) []string {
	// Simple XML parsing (Colly handles XML too via OnXML if configured, or just OnHTML with xml namespaces)
	// For simplicity, using Colly's XML support
	var cfg db.FeedConfig
	json.Unmarshal(feed.Config, &cfg) // Ignore error, optional

	c := colly.NewCollector()
	var urls []string

	c.OnXML("//loc", func(e *colly.XMLElement) {
		link := e.Text
		normalized := normalizeURL(link)
		if s.isValidURL(normalized, cfg) {
			urls = append(urls, normalized)
		}
	})

	c.Visit(feed.URL)
	return urls
}

func (s *Scraper) isValidURL(u string, cfg db.FeedConfig) bool {
	if cfg.URLPattern != "" {
		matched, _ := regexp.MatchString(cfg.URLPattern, u)
		if !matched {
			return false
		}
	}
	if cfg.DenyPattern != "" {
		matched, _ := regexp.MatchString(cfg.DenyPattern, u)
		if matched {
			return false
		}
	}
	return !strings.Contains(u, "javascript:") && !strings.Contains(u, "#")
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
