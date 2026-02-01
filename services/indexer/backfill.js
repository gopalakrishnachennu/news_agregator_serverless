const { Kafka } = require('kafkajs');
const { Pool } = require('pg');
const crypto = require('crypto');

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://news_user:news_password@localhost:5433/news_db';
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';
const TOPIC = process.env.KAFKA_TOPIC || 'raw-articles';
const DAYS = parseInt(process.env.BACKFILL_DAYS || '7', 10);
const BATCH_SIZE = parseInt(process.env.BACKFILL_BATCH_SIZE || '200', 10);
const MAX = parseInt(process.env.BACKFILL_MAX || '0', 10);

function hashUrl(url) {
  return crypto.createHash('sha256').update(url).digest('hex') + '.html';
}

async function run() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const kafka = new Kafka({ clientId: 'backfill-raw-articles', brokers: [KAFKA_BROKER] });
  const producer = kafka.producer();

  await producer.connect();

  let offset = 0;
  let totalSent = 0;
  const limit = BATCH_SIZE;

  while (true) {
    const res = await pool.query(
      `
      SELECT id, url, source_id, published_at
      FROM articles
      WHERE published_at > NOW() - make_interval(days => $1)
      ORDER BY published_at DESC
      LIMIT $2 OFFSET $3
      `,
      [DAYS, limit, offset]
    );

    if (res.rows.length === 0) break;

    const messages = res.rows.map((row) => ({
      value: JSON.stringify({
        url: row.url,
        source_id: row.source_id,
        s3_key: hashUrl(row.url),
        fetched_at: new Date().toISOString(),
        published_at: row.published_at,
      }),
    }));

    await producer.send({ topic: TOPIC, messages });

    totalSent += messages.length;
    offset += res.rows.length;

    if (MAX > 0 && totalSent >= MAX) break;
  }

  await producer.disconnect();
  await pool.end();

  console.log(`Backfill complete. Sent ${totalSent} messages to ${TOPIC}.`);
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
