import { Kafka } from 'kafkajs';
import { HtmlStorage } from './storage/minio';
import { fetchPage } from './lib/fetcher';

const kafka = new Kafka({
    clientId: 'article-fetcher',
    brokers: [(process.env.KAFKA_BROKER || 'localhost:9092')]
});

const consumer = kafka.consumer({ groupId: 'fetcher-group-1' });
const producer = kafka.producer();

const storage = new HtmlStorage();

async function run() {
    await consumer.connect();
    await producer.connect();

    await consumer.subscribe({ topic: 'new-urls', fromBeginning: false });

    console.log("Article Fetcher started. Listening for URLs...");

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            if (!message.value) return;
            try {
                const job = JSON.parse(message.value.toString());
                const url = job.url;
                console.log(`Processing URL: ${url}`);

                const html = await fetchPage(url);

                if (html) {
                    // Save to S3
                    const objectKey = await storage.saveHtml(url, html);
                    console.log(`Saved HTML to ${objectKey}`);

                    // Publish to next stage
                    await producer.send({
                        topic: 'raw-articles',
                        messages: [
                            {
                                value: JSON.stringify({
                                    url: url,
                                    source_id: job.source_id,
                                    s3_key: objectKey,
                                    fetched_at: new Date().toISOString(),
                                    published_at: job.published_at || null
                                })
                            }
                        ]
                    });
                }
            } catch (err) {
                console.error("Error processing message:", err);
            }
        },
    });
}

run().catch(console.error);
