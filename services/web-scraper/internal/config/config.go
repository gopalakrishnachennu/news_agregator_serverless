package config

import (
	"os"
	"strconv"
)

type Config struct {
	DatabaseURL  string
	KafkaBroker  string
	KafkaTopic   string
	PollInterval int 
}

func Load() *Config {
	pollInterval, _ := strconv.Atoi(getEnv("POLL_INTERVAL_MINUTES", "5"))

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		panic("DATABASE_URL environment variable is required")
	}

	return &Config{
		DatabaseURL:  dbURL,
		KafkaBroker:  getEnv("KAFKA_BROKER", "kafka:9092"),
		KafkaTopic:   getEnv("KAFKA_TOPIC", "new-urls"),
		PollInterval: pollInterval,
	}
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
