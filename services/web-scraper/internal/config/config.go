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

	return &Config{
		DatabaseURL:  getEnv("DATABASE_URL", "postgres://news_user:news_password@postgres:5432/news_db"),
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
