# News Aggregator Design Specification

## 1. System Overview
 This system is a high-throughput, near real-time news aggregation engine designed to discover, ingest, cluster, and display news stories from diverse global sources. It differentiates itself through "Google-like" discovery using standard feeds (RSS/Sitemaps) rather than brittle HTML scraping, ensuring legal compliance and publisher friendliness. Key features include a sophisticated "Best Image" pipeline using ML for visual relevance, intelligent deduplication to group related coverage into clusters, and a high-performance Next.js frontend optimized for Core Web Vitals and SEO. The backend relies on an event-driven microservices architecture to handle millions of articles daily, ensuring fault tolerance and scalability.

## 2. Architecture Diagram

```ascii
                                      +------------------+
                                      |   CDN (Cloudflare)|
                                      +--------+---------+
                                               |
                                     +---------v----------+
                                     |    API Gateway     |
                                     +---------+----------+
                                               |
        +--------------------------------------+---------------------------------------+
        |                                                                              |
+-------v-------+      +-------------+      +-------------+      +--------------+  +---v---+
|  Next.js SSR  |      | Search Svc  |      |  Topic Svc  |      | User/Auth Svc|  |Image  |
|  (Frontend)   |      | (Elastic)   |      |  (Go/Node)  |      |              |  |Proxy  |
+-------+-------+      +------+------+      +------+------+      +--------------+  +---+---+
        |                     ^                    ^                                   ^
        |                     |                    |                                   |
--------+---------------------+--------------------+-----------------------------------+----
                                     BACKEND SERVICES
--------------------------------------------------------------------------------------------
                                               ^
                                               |
                                    +----------+-----------+
                                    |    Read/Write API    |
                                    +----------+-----------+
                                               |
                                    +----------v-----------+
                                    | Postgres (Metadata)  |
                                    +----------------------+

============================================================================================
                                     INGESTION PIPELINE (Async)
============================================================================================

[Sources] -->  [Feed Collector]
(RSS/Sitemap)        |
                     v
             [Msg Queue (Kafka)] Topic: `new-urls`
                     |
                     v
             [Article Fetcher] --(fetch HTML/metadata)--> [S3 (Raw HTML)]
                     |
                     v
             [Msg Queue (Kafka)] Topic: `raw-articles`
                     |
                     v
             [Parser Infrastructure]
             |  1. Metadata Normalizer (Title, Time, Author)
             |  2. Image Extractor (Finds all candidate images)
             |  3. Content Sanitizer (Snippet generation)
             |
             v
     +-------+-------+
     |               |
     v               v
[Image Ranker]   [Dedupe/Cluster]
(ML/Scoring)     (SimHash/Vector)
     |               |
     v               v
[Image Resizer]  [Search Indexer]
     |               |
     v               v
 [S3 (Images)]   [Elasticsearch]
```

## 3. Data Flow: Article Lifecycle

1.  **Discovery**:
    *   **Feed Collector** polls registered RSS feeds and Google News Sitemap URLs.
    *   New URLs are checked against a Redis bloom filter to avoid duplicate processing.
    *   Unique URLs are pushed to the `new-urls` Kafka topic.

2.  **Ingestion & Parsing**:
    *   **Article Fetcher** consumes `new-urls`. It respects `robots.txt` and fetches the page content (headers + body) with a polite User-Agent.
    *   Raw content is stored in Object Storage (S3) for debugging/reprocessing (retention: 7 days).
    *   **Parser Worker** extracts semantic data: headline, published_time (normalized to UTC), author, description, and *all* image candidates (`og:image`, `<img>` tags, JSON-LD).
    *   Parsed data event is emitted to `parsed-articles`.

3.  **Enrichment (Image & Text)**:
    *   **Image Ranking Service** receives the article. It downloads candidate images, scores them (resolution, aspect ratio, safety check), and selects the "Best Hero".
    *   Selected image is resized/optimized (WebP) and uploaded to CDN storage.
    *   **Dedupe Service** generates a SimHash or Text Embedding of the title+snippet. It queries the `clusters` database to find a matching topic.
        *   *Match found*: Article added to existing cluster.
        *   *No match*: New cluster created.

4.  **Indexing & Serving**:
    *   The finalized article (with ClusterID and BestImageID) is written to **Postgres**.
    *   Search document is indexed in **Elasticsearch** (or equivalent) for full-text search.
    *   **Topic Service** invalidates cache for relevant tags/categories.

5.  **Display**:
    *   User requests Home Feed. **API** fetches top clusters from Postgres (cached in Redis).
    *   **Frontend** renders the cluster card using the Hero Image and the top 2-3 headlines.

## 4. Core Services

| Service | Responsibility | Technology Choices | Scaling Strategy |
| :--- | :--- | :--- | :--- |
| **Feed Collector** | Polls thousands of RSS/Atom feeds and sitemaps. Tracks "last modified" to minimize bandwidth. | Go or Rust (high concurrency), Redis (for scheduling). | Horizontal scaling of workers; Sharding feeds by hash ID. |
| **Article Fetcher** | Downloads HTML from discovered URLs. Handles retries, proxies, and robots.txt compliance. | Node.js (Puppeteer/Cheerio) or Go. | Async queue consumers. Autoscaling based on queue lag. |
| **Metadata Normalizer** | Cleans titles, standardizes dates (ISO8601), resolves canonical URLs. | Python (easier NLP libs) or Node.js. | Stateless workers. |
| **Image Extractor** | Finds all possible images in DOM/Meta tags. | Node.js (JSDOM/Cheerio). | Part of the parser pipeline. |
| **Image Ranker** | The "Brain" for visuals. Downloads, analyzes, and picks the best image. | Python (OpenCV/Pillow, TensorFlow/PyTorch if using CLIP). | GPU-optimized instances if using heavy ML, otherwise CPU bound. |
| **Dedupe/Clustering** | Groups similar stories using LSH (Locality Sensitive Hashing) or Vector Similarity. | Python (Scikit-learn/Faiss) or Go for pure SimHash speed. | In-memory caching of active cluster centroids. |
| **Search/Topic Svc** | Provides APIs for "Tech", "Politics", or keyword search. | Elasticsearch / Opensearch. | Standard ES cluster scaling. |

## 5. Database Schema (PostgreSQL)

**Rationale**: Postgres is the primary source of truth for relational data (Sources -> Feeds -> Articles -> Clusters).

```sql
-- Track authorized publishers
CREATE TABLE sources (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    logo_url TEXT,
    trust_score FLOAT DEFAULT 0.5, -- For ranking
    is_active BOOLEAN DEFAULT TRUE,
    scrape_rules JSONB -- Custom CSS selectors if RSS fails
);

-- Individual RSS/Sitemap endpoints
CREATE TABLE feeds (
    id SERIAL PRIMARY KEY,
    source_id INT REFERENCES sources(id),
    url TEXT NOT NULL,
    type VARCHAR(50), -- 'rss', 'atom', 'sitemap_news'
    last_fetched_at TIMESTAMPTZ,
    error_count INT DEFAULT 0
);

-- Grouping of related articles
CREATE TABLE clusters (
    id BIGSERIAL PRIMARY KEY,
    primary_article_id BIGINT, -- The "Lead" story
    title TEXT, -- Synthesis or title of primary article
    topic VARCHAR(50), -- e.g., 'technology', 'world'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),
    score FLOAT -- "Hotness" of the cluster
);
CREATE INDEX idx_clusters_score_topic ON clusters(topic, score DESC);

-- The core content
CREATE TABLE articles (
    id BIGSERIAL PRIMARY KEY,
    cluster_id BIGINT REFERENCES clusters(id),
    source_id INT REFERENCES sources(id),
    url TEXT UNIQUE NOT NULL,
    canonical_url TEXT,
    title TEXT NOT NULL,
    snippet TEXT, -- 200 char max
    published_at TIMESTAMPTZ,
    author VARCHAR(255),
    
    -- Best Image metadata
    best_image_url TEXT, 
    best_image_width INT,
    best_image_height INT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_articles_cluster ON articles(cluster_id);
CREATE INDEX idx_articles_pub_time ON articles(published_at DESC);

-- All candidate images found for an article (for debugging/re-ranking)
CREATE TABLE images (
    id BIGSERIAL PRIMARY KEY,
    article_id BIGINT REFERENCES articles(id),
    original_url TEXT,
    score FLOAT, -- The computed quality score
    reasons JSONB, -- Why it was picked/rejected
    is_hero BOOLEAN DEFAULT FALSE
);
```

## 6. Best Image Pipeline (Critical)

This pipeline ensures every story has a high-quality visual, avoiding "missing image" placeholders or tiny pixel trackers.

### A. Candidate Sources (In Priority Order)
1.  **Meta Tags**: `og:image`, `twitter:image`, `image_src`.
2.  **Schema.org**: JSON-LD `ImageObject` or `NewsArticle.image`.
3.  **Media RSS**: `<media:content>` or `<enclosure>` tags in the feed.
4.  **Body Content**: Large `<img>` tags found within the first 1000px of the article body.

### B. Filtering Rules (Hard Gates)
*   **Min Resolution**: Must be > 600px width AND > 400px height.
*   **Aspect Ratio**: Must be between 1.3:1 (landscape) and 1.91:1. Reject vertical images (portraits) unless no other option exists.
*   **Blocklist**: Reject URLs containing `logo`, `banner`, `ad`, `pixel`, `tracker`, `sprite`.
*   **File Size**: Reject images < 5KB (likely icons).

### C. Scoring Formula (Weighted Sum)
Each candidate image is assigned a score (0-100).
*   **Score = (ResolutionScore * 0.3) + (PositionScore * 0.2) + (BlurDetection * 0.2) + (AspectBonus * 0.1) + (Relevance * 0.2)**

| Metric | Logic |
| :--- | :--- |
| **ResolutionScore** | `min(1.0, width / 1200)` - Favor HD images. |
| **PositionScore** | 100 if from `og:image`. 80 if first `<img>` in body. 50 if further down. |
| **BlurDetection** | Use Laplacian Variance (OpenCV). If var < 100, score = 0 (Reject). |
| **AspectBonus** | 100 if ratio is ~16:9. 0 if extremely wide/tall. |
| **Relevance** | (Optional/Advanced) Use **CLIP** (Contrastive Language-Image Pre-Training). Calculate cosine similarity between *Article Title* and *Image*. If similarity < 0.2, penalize heavily. |

### D. Safety & Fallback
*   **NSFW Check**: Run a lightweight classifier (e.g., NudeNet-lite) on the selected image. If positive (>0.9 confidence), discard image.
*   **Fallback**: If NO image passes filters -> Use the Publisher's Logo (stored in `sources` table) as a fallback, or a topic-specific generic illustration (e.g., generic "Politics" icon).

### E. Storage
*   Images are **never hotlinked**.
*   Selected image is downloaded, resized to `1200w`, `640w`, `320w` (WebP format).
*   Stored in S3/GCS with a hashed filename (e.g., `s3://news-assets/2023/10/{hash}_1200.webp`).

## 7. API Design (RESTful)

All responses are JSON. Auth via Bearer token (optional for public reads).

*   `GET /feeds`: List configured providers.
*   `GET /stories/top?topic=tech&limit=20`: Get top clusters for a topic.
    *   **Response**: `[{ "clusterId": "123", "title": "Google releases AI", "heroImage": "...", "articles": [...] }]`
*   `GET /story/{clusterId}`: specific detailed view of a story cluster.
*   `GET /source/{domain}`: All stories from a specific publisher (e.g., nytimes.com).
*   `GET /search?q=query`: Full text search.

### Pagination & Caching
*   **Strategy**: Cursor-based pagination (`?cursor=timestamp_id`) for infinite feed performance.
*   **Caching**:
    *   `Redis`: Cache API responses for "Top Stories" (TTL: 5 mins).
    *   `CDN`: Cache image assets (TTL: 1 year, immutable).

## 8. Frontend Architecture

*   **Framework**: Next.js 14+ (App Router).
*   **SSR Strategy**:
    *   **Home/Topic Pages**: ISR (Incremental Static Regeneration) every 5 minutes. Critical for speed + SEO.
    *   **Story Cluster Pages**: SSR (Server Side Rendering) or short-interval ISR.
*   **SEO**:
    *   Dynamic `sitemap.xml` generated daily from `clusters` table.
    *   **JSON-LD** Schema: `NewsArticle` or `ItemList` on the homepage.
    *   **Open Graph**: Dynamic generation of `og:image` featuring the cluster's hero image + headline overlay.

## 9. Reliability & Observability

*   **Retries**: Exponential backoff for fetching feeds (2s, 4s, 8s...). Dead Letter Queue (DLQ) after 5 failed attempts.
*   **Idempotency**: Use URL hash as key. Redis Bloom Filter prevents reprocessing same URL within 24 hours.
*   **Metrics (Prometheus/Grafana)**:
    *   `ingestion_lag_seconds`: Time from "Published At" to "Available in API".
    *   `parse_failure_rate`: % of URLs that fail parsing.
    *   `image_hit_rate`: % of articles with a valid Hero Image found.
*   **Logging**: Structured JSON logs. Must include `trace_id` propagated through Kafka to trace a story from Ingestion -> Display.

## 10. Testing Plan

*   **Unit Tests**:
    *   `ImageScorer.test.js`: Mock different image dimensions/types and assert correct score calculation.
    *   `Parser.test.js`: Feed raw HTML samples and verify metadata extraction matches expected output.
*   **Integration Tests**:
    *   Spin up local Kafka + Postgres (Docker Compose).
    *   Publish a mock RSS feed item.
    *   Assert it appears in the `articles` table with a computed cluster.
*   **Visual Regression**:
    *   Verify "Best Image" selection manually on a sample set of 100 diverse articles to tune weights.

## 11. Security & Compliance

*   **Link Hygiene**: All external links must be `rel="nofollow noopener"` to prevent bad SEO juice leak and security risks.
*   **Copyright Compliance**:
    *   Display **Attribution** clearly (Source Name + Logo).
    *   Snippet limit: Max 200 characters or 10% of article (fair use).
    *   **Deep Linking**: Titles/Cards link directly to the *Publisher's* site, not an internal reader view (unless specific license exists).
*   **Anti-Abuse**:
    *   Cloudflare Web Application Firewall (WAF) in front of API.
    *   Rate limit search endpoints to 10 req/min per IP.
