package main

import (
	"context"
	"database/sql"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/news-aggregator/feed-collector/internal/database"
	"github.com/news-aggregator/feed-collector/internal/queue"
	"github.com/news-aggregator/feed-collector/internal/rss"
)

const (
	PollInterval = 30 * time.Second
	WorkerCount  = 10
)

func main() {
	log.Println("Starting Feed Collector Service...")

	// 1. Connect to DB
	connStr := os.Getenv("DATABASE_URL")
	if connStr == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		log.Fatalf("Failed to connect to DB: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Printf("Warning: DB not reachable yet: %v", err)
	} else {
		log.Println("Connected to Database")
	}

	repo := database.NewRepo(db)

	// 2. Connect to Kafka
	kafkaBroker := os.Getenv("KAFKA_BROKER")
	if kafkaBroker == "" {
		kafkaBroker = "localhost:9092"
	}
	producer, err := queue.NewProducer(kafkaBroker, "new-urls")
	if err != nil {
		log.Printf("Warning: Failed to create Kafka producer: %v", err)
	} else {
		defer producer.Close()
		log.Println("Connected to Kafka")
	}

	// 3. Start Poller
	poller := rss.NewPoller(repo, producer)
	
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle Graceful Shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Println("Starting poll loop...")
		if err := poller.Start(ctx, WorkerCount, PollInterval); err != nil {
			log.Printf("Poller error: %v", err)
		}
	}()

	<-sigChan
	log.Println("Shutting down...")
}
