import { Kafka } from 'kafkajs';
import { Pool } from 'pg';
import axios from 'axios';

// --- DB Setup ---
if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
}
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// --- Kafka Setup ---
const kafka = new Kafka({
    clientId: 'indexer-service',
    brokers: [(process.env.KAFKA_BROKER || 'localhost:9092')]
});
const consumer = kafka.consumer({ groupId: 'indexer-group-1' });

const DEFAULT_CLUSTER_DISTANCE_THRESHOLD = parseFloat(process.env.CLUSTER_DISTANCE_THRESHOLD || '0.22');
const DEFAULT_CLUSTER_TIME_WINDOW_HOURS = parseInt(process.env.CLUSTER_TIME_WINDOW_HOURS || '24', 10);
const DEFAULT_TEXT_SIMILARITY_THRESHOLD = parseFloat(process.env.TEXT_SIMILARITY_THRESHOLD || '0.45');

let settingsCache = {
    updatedAt: 0,
    distance: DEFAULT_CLUSTER_DISTANCE_THRESHOLD,
    hours: DEFAULT_CLUSTER_TIME_WINDOW_HOURS,
    textSim: DEFAULT_TEXT_SIMILARITY_THRESHOLD,
};

async function getClusteringSettings(client: any) {
    const now = Date.now();
    if (now - settingsCache.updatedAt < 60_000) {
        return settingsCache;
    }

    try {
        const res = await client.query(
            `SELECT key, value FROM system_settings
             WHERE key IN ('cluster_distance_threshold', 'cluster_time_window_hours', 'text_similarity_threshold')`
        );

        let distance = settingsCache.distance;
        let hours = settingsCache.hours;
        let textSim = settingsCache.textSim;

        for (const row of res.rows) {
            const key = row.key;
            const val = typeof row.value === 'string' ? row.value : row.value;
            if (key === 'cluster_distance_threshold') {
                const parsed = parseFloat(val);
                if (!Number.isNaN(parsed)) distance = parsed;
            } else if (key === 'cluster_time_window_hours') {
                const parsed = parseInt(val, 10);
                if (!Number.isNaN(parsed)) hours = parsed;
            } else if (key === 'text_similarity_threshold') {
                const parsed = parseFloat(val);
                if (!Number.isNaN(parsed)) textSim = parsed;
            }
        }

        settingsCache = { updatedAt: now, distance, hours, textSim };
    } catch (e) {
        // Keep cached defaults on error
    }

    return settingsCache;
}

async function saveArticle(data: any) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 0. Check Blacklist
        const blacklistRes = await client.query('SELECT keyword FROM blocked_keywords');
        const blockedWords = blacklistRes.rows.map(r => r.keyword.toLowerCase());
        const titleLower = data.title.toLowerCase();

        for (const word of blockedWords) {
            if (titleLower.includes(word)) {
                console.log(`Blocked article "${data.title}" due to keyword: "${word}"`);
                await client.query('ROLLBACK');
                return; // Stop processing
            }
        }

        // 1. Ensure Source exists (Look up by domain)
        let sourceId = data.source_id ?? data.sourceId;
        if (!sourceId && data.originalUrl) {
            try {
                const urlObj = new URL(data.originalUrl);
                let hostname = urlObj.hostname.replace('www.', '');
                const sourceRes = await client.query('SELECT id FROM sources WHERE domain = $1 OR $1 LIKE \'%\' || domain', [hostname]);
                if (sourceRes.rows.length > 0) {
                    sourceId = sourceRes.rows[0].id;
                }
            } catch (err) {
                console.warn('Failed to parse domain from URL:', data.originalUrl);
            }
        }

        // 2. Insert Cluster or Find Existing (Smart Semantic Clustering)
        // First, get embedding for the title
        let embeddingVector = null;
        try {
            const embedRes = await axios.post('http://embedding-service:8000/embed', { text: data.title });
            embeddingVector = embedRes.data.vector;
        } catch (err) {
            console.warn('Failed to get embedding:', err);
        }

        let clusterId;
        let similarClusterRes: any = { rows: [] };

        const clusteringSettings = await getClusteringSettings(client);
        const distanceThreshold = clusteringSettings.distance;
        const timeWindowHours = clusteringSettings.hours;
        const textSimilarityThreshold = clusteringSettings.textSim;

        // If we have a vector, use semantic search (time-windowed)
        if (embeddingVector) {
            similarClusterRes = await client.query(
                `SELECT id, title, (embedding <=> $1) as dist 
                 FROM clusters 
                 WHERE last_updated_at > NOW() - make_interval(hours => $2)
                 AND (embedding <=> $1) < $3
                 ORDER BY dist ASC 
                 LIMIT 1`,
                [`[${embeddingVector.join(',')}]`, timeWindowHours, distanceThreshold]
            );
        }

        // Fallback to text similarity if no vector (or no match found yet)
        if (similarClusterRes.rows.length === 0) {
            similarClusterRes = await client.query(
                `SELECT id, title, similarity(title, $1) as sim 
                 FROM clusters 
                 WHERE last_updated_at > NOW() - make_interval(hours => $2)
                 AND similarity(title, $1) > $3 
                 ORDER BY sim DESC 
                 LIMIT 1`,
                [data.title, timeWindowHours, textSimilarityThreshold]
            );
        }

        if (similarClusterRes.rows.length > 0) {
            clusterId = similarClusterRes.rows[0].id;
            console.log(`Found cluster match: "${similarClusterRes.rows[0].title}"`);

            // Touch last_updated_at so it bumps to top
            await client.query('UPDATE clusters SET last_updated_at = NOW() WHERE id = $1', [clusterId]);
        } else {
            // Parse as string for SQL insertion
            const vectorStr = embeddingVector ? `[${embeddingVector.join(',')}]` : null;

            const clusterRes = await client.query(
                'INSERT INTO clusters (title, topic, score, embedding) VALUES ($1, $2, $3, $4) RETURNING id',
                [data.title, 'general', 10.0, vectorStr]
            );
            clusterId = clusterRes.rows[0].id;
        }

        // 3. Insert Article
        const articleRes = await client.query(
            `INSERT INTO articles 
            (cluster_id, source_id, url, title, snippet, published_at, author, best_image_url, best_image_width, best_image_height, image_quality_score)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id`,
            [
                clusterId,
                sourceId || null,
                data.originalUrl,
                data.title,
                data.excerpt ? data.excerpt.substring(0, 200) : '',
                data.publishedTime || new Date(),
                data.author,
                data.bestImage ? data.bestImage.url : null,
                data.bestImage ? data.bestImage.width : 0,
                data.bestImage ? data.bestImage.height : 0,
                data.bestImage ? data.bestImage.score : 0
            ]
        );

        // 4. Update Cluster to point to this primary article
        // 4. Update Cluster to point to this primary article IF it's a new cluster or has no primary
        // (For now, we just leave the original as primary to keep the "first breaker" as the lead)
        if (similarClusterRes.rows.length === 0) {
            await client.query('UPDATE clusters SET primary_article_id = $1 WHERE id = $2', [articleRes.rows[0].id, clusterId]);
        }

        await client.query('COMMIT');
        console.log(`Saved article: ${data.title} (ID: ${articleRes.rows[0].id})`);

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('DB Error:', e);
    } finally {
        client.release();
    }
}


// --- Orphan Poller (For articles inserted via Admin API) ---
async function pollOrphans() {
    console.log("Starting Orphan Poller...");
    while (true) {
        try {
            const client = await pool.connect();
            try {
                // Find articles with NULL cluster_id
                const res = await client.query('SELECT id, title, url, snippet, source_id, published_at FROM articles WHERE cluster_id IS NULL LIMIT 20');

                if (res.rows.length > 0) {
                    console.log(`Found ${res.rows.length} orphans. Clustering...`);

                    for (const article of res.rows) {
                        try {
                            await clusterOrphan(article, client);
                        } catch (e) {
                            console.error(`Failed to cluster orphan ${article.id}:`, e);
                        }
                    }
                }
            } finally {
                client.release();
            }
        } catch (e) {
            console.error("Orphan Poller Error:", e);
        }

        // Wait 5 seconds before next batch
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

async function clusterOrphan(article: any, client: any) {
    // 1. Get embedding
    let embeddingVector = null;
    try {
        const embedRes = await axios.post('http://embedding-service:8000/embed', { text: article.title });
        embeddingVector = embedRes.data.vector;
    } catch (err) {
        // console.warn('Failed to get embedding:', err);
    }

    let clusterId;
    let similarClusterRes: any = { rows: [] };

    const clusteringSettings = await getClusteringSettings(client);
    const distanceThreshold = clusteringSettings.distance;
    const timeWindowHours = clusteringSettings.hours;
    const textSimilarityThreshold = clusteringSettings.textSim;

    // 2. Find similar cluster (time-windowed)
    if (embeddingVector) {
        similarClusterRes = await client.query(
            `SELECT id, title, (embedding <=> $1) as dist 
             FROM clusters 
             WHERE last_updated_at > NOW() - make_interval(hours => $2)
             AND (embedding <=> $1) < $3
             ORDER BY dist ASC 
             LIMIT 1`,
            [`[${embeddingVector.join(',')}]`, timeWindowHours, distanceThreshold]
        );
    }

    if (similarClusterRes.rows.length === 0) {
        similarClusterRes = await client.query(
            `SELECT id, title, similarity(title, $1) as sim 
             FROM clusters 
             WHERE last_updated_at > NOW() - make_interval(hours => $2)
             AND similarity(title, $1) > $3 
             ORDER BY sim DESC 
             LIMIT 1`,
            [article.title, timeWindowHours, textSimilarityThreshold]
        );
    }

    if (similarClusterRes.rows.length > 0) {
        clusterId = similarClusterRes.rows[0].id;
        console.log(`[Orphan] Joined cluster: "${similarClusterRes.rows[0].title}"`);
        await client.query('UPDATE clusters SET last_updated_at = NOW() WHERE id = $1', [clusterId]);
    } else {
        const vectorStr = embeddingVector ? `[${embeddingVector.join(',')}]` : null;
        const clusterRes = await client.query(
            'INSERT INTO clusters (title, topic, score, embedding, primary_article_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [article.title, 'general', 10.0, vectorStr, article.id]
        );
        clusterId = clusterRes.rows[0].id;
        console.log(`[Orphan] Created new cluster: "${article.title}"`);
    }

    // 3. Update Article
    await client.query('UPDATE articles SET cluster_id = $1 WHERE id = $2', [clusterId, article.id]);
}

async function run() {
    await consumer.connect();
    await consumer.subscribe({ topic: 'enriched-articles', fromBeginning: false });

    console.log("Indexer Service started...");

    // Start Poller in background
    pollOrphans();

    await consumer.run({
        eachMessage: async ({ message }) => {
            if (!message.value) return;
            try {
                const data = JSON.parse(message.value.toString());
                await saveArticle(data);
            } catch (err) {
                console.error("Error processing message:", err);
            }
        },
    });
}

run().catch(console.error);
