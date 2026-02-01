package kafka

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/segmentio/kafka-go"
)

type Producer struct {
	Writer *kafka.Writer
}

type ScrapeJob struct {
	URL      string `json:"url"`
	SourceID int    `json:"source_id"`
	FeedID   int    `json:"feed_id"`
}

func NewProducer(broker, topic string) *Producer {
	w := &kafka.Writer{
		Addr:     kafka.TCP(broker),
		Topic:    topic,
		Balancer: &kafka.LeastBytes{},
	}
	return &Producer{Writer: w}
}

func (p *Producer) Close() {
	if err := p.Writer.Close(); err != nil {
		log.Printf("Failed to close Kafka writer: %v", err)
	}
}

func (p *Producer) PublishURLs(urls []string, sourceID, feedID int) error {
	var messages []kafka.Message
	for _, u := range urls {
		job := ScrapeJob{
			URL:      u,
			SourceID: sourceID,
			FeedID:   feedID,
		}
		bytes, _ := json.Marshal(job)
		messages = append(messages, kafka.Message{
			Key:   []byte(u),
			Value: bytes,
		})
	}

	if len(messages) == 0 {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return p.Writer.WriteMessages(ctx, messages...)
}
