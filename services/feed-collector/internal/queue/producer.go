package queue

import (
	"encoding/json"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
)

type ScrapeJob struct {
	URL         string     `json:"url"`
	SourceID    int        `json:"source_id"`
	FeedID      int        `json:"feed_id"`
	PublishedAt *time.Time `json:"published_at,omitempty"`
}

type Producer struct {
	p     *kafka.Producer
	topic string
}

func NewProducer(broker string, topic string) (*Producer, error) {
	p, err := kafka.NewProducer(&kafka.ConfigMap{"bootstrap.servers": broker})
	if err != nil {
		return nil, err
	}
	return &Producer{p: p, topic: topic}, nil
}

func (k *Producer) Publish(job ScrapeJob) error {
	value, err := json.Marshal(job)
	if err != nil {
		return err
	}

	return k.p.Produce(&kafka.Message{
		TopicPartition: kafka.TopicPartition{Topic: &k.topic, Partition: kafka.PartitionAny},
		Value:          value,
	}, nil)
}

func (k *Producer) Close() {
	k.p.Close()
}
