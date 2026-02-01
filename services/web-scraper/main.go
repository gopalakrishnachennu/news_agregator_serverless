package main

import (
	"log"
	"time"

	"github.com/gopalakrishnachennu/news-aggregator/services/web-scraper/internal/config"
	"github.com/gopalakrishnachennu/news-aggregator/services/web-scraper/internal/db"
	"github.com/gopalakrishnachennu/news-aggregator/services/web-scraper/internal/kafka"
	"github.com/gopalakrishnachennu/news-aggregator/services/web-scraper/internal/scraper"
	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables
	_ = godotenv.Load()

	cfg := config.Load()
	log.Println("Starting Web Scraper Service...")

	// Connect to DB
	var database *db.DB
	for {
		var err error
		database, err = db.New(cfg.DatabaseURL)
		if err == nil {
			break
		}
		log.Printf("Failed to connect to DB: %v (retrying in 5s)", err)
		time.Sleep(5 * time.Second)
	}
	defer database.Close()

	// Connect to Kafka
	producer := kafka.NewProducer(cfg.KafkaBroker, cfg.KafkaTopic)
	defer producer.Close()

	// Initialize Scraper
	scr := scraper.New(database, producer)

	// Start Polling Loop
	ticker := time.NewTicker(time.Duration(cfg.PollInterval) * time.Minute)
	defer ticker.Stop()

	// Run immediately once
	runScrapeCycle(scr)

	for range ticker.C {
		runScrapeCycle(scr)
	}
}

func runScrapeCycle(s *scraper.Scraper) {
	log.Println("Running scrape cycle...")
	if err := s.ProcessFeeds(); err != nil {
		log.Printf("Error in scrape cycle: %v", err)
	}
}
