import { Kafka } from 'kafkajs';
import { Client } from 'minio';
import { parseHtml } from './lib/parser';

// --- MinIO Setup (Should share code w/ fetcher in a real monorepo pkg) ---
const minioClient = new Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000'),
    useSSL: false,
    accessKey: process.env.MINIO_ACCESS_KEY || 'minio_user',
    secretKey: process.env.MINIO_SECRET_KEY || 'minio_password',
});
const bucketName = process.env.MINIO_BUCKET || 'raw-articles';

async function getHtmlFromS3(objectKey: string): Promise<string> {
    const stream = await minioClient.getObject(bucketName, objectKey);
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        stream.on('error', reject);
    });
}

// --- Kafka Setup ---
const kafka = new Kafka({
    clientId: 'article-parser',
    brokers: [(process.env.KAFKA_BROKER || 'localhost:9092')]
});
const consumer = kafka.consumer({ groupId: 'parser-group-1' });
const producer = kafka.producer();

async function run() {
    await consumer.connect();
    await producer.connect();
    await consumer.subscribe({ topic: 'raw-articles', fromBeginning: false });

    console.log("Parser Service started...");

    await consumer.run({
        eachMessage: async ({ message }) => {
            if (!message.value) return;

            try {
                const job = JSON.parse(message.value.toString());
                console.log(`Parsing article: ${job.url}`);

                const s3Key = job.s3_key ?? job.s3Key;
                const html = await getHtmlFromS3(s3Key);
                const result = parseHtml(html, job.url);

                // Publish parsed event
                await producer.send({
                    topic: 'parsed-articles',
                    messages: [
                        {
                            value: JSON.stringify({
                                ...result,
                                originalUrl: job.url,
                                source_id: job.source_id ?? job.sourceId,
                                fetched_at: job.fetched_at ?? job.fetchedAt,
                                publishedTime: job.published_at ? new Date(job.published_at) : (result.publishedTime || new Date())
                            })
                        }
                    ]
                });
                console.log(`Parsed & Published: ${result.title}`);

                // Throttle to save CPU
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (err) {
                console.error("Error processing message:", err);
            }
        },
    });
}

run().catch(console.error);
