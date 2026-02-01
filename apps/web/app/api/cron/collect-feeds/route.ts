import Parser from 'rss-parser';
import { assertCronAuth } from '@/lib/cron';
import { getDb, COLLECTIONS } from '@/lib/firebase';
import { enqueueUrl } from '@/lib/queue';
import { normalizeUrl } from '@/lib/url';
import { parseSitemapUrls } from '@/lib/sitemap';
import { scrapeHtmlLinks } from '@/lib/html-scraper';

const FEED_LIMIT = parseInt(process.env.FEED_BATCH_LIMIT || '20', 10);
const URLS_PER_FEED_LIMIT = parseInt(process.env.FEED_URL_LIMIT || '200', 10);

type FeedConfig = {
  selector?: string;
  url_pattern?: string;
  deny_pattern?: string;
  max_urls?: number;
};

function normalizeConfig(raw: any): FeedConfig {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

function applyUrlFilters(urls: string[], config: FeedConfig): string[] {
  const maxUrls = config.max_urls ? Math.max(1, config.max_urls) : URLS_PER_FEED_LIMIT;
  const urlPattern = config.url_pattern ? new RegExp(config.url_pattern) : null;
  const denyPattern = config.deny_pattern ? new RegExp(config.deny_pattern) : null;

  const out: string[] = [];
  for (const url of urls) {
    if (denyPattern && denyPattern.test(url)) continue;
    if (urlPattern && !urlPattern.test(url)) continue;
    out.push(url);
    if (out.length >= maxUrls) break;
  }
  return out;
}

export async function GET(request: Request) {
  try {
    assertCronAuth(request);
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const parser = new Parser({ timeout: 10_000 });
  const db = getDb();

  // Get active feeds
  const feedsSnapshot = await db.collection(COLLECTIONS.FEEDS)
    .limit(FEED_LIMIT)
    .get();

  let processed = 0;
  let queued = 0;
  const errors: string[] = [];

  for (const feedDoc of feedsSnapshot.docs) {
    const feed = { id: feedDoc.id, ...feedDoc.data() } as any;

    try {
      const config = normalizeConfig(feed.config);
      const feedType = feed.type;

      if (feedType === 'rss' || feedType === 'atom') {
        const feedData = await parser.parseURL(feed.url);
        processed += 1;

        const rawItems = (feedData.items || []).filter((item) => item.link);
        const allowedLinks = new Set(
          applyUrlFilters(
            rawItems.map((item) => item.link || '').filter(Boolean),
            config
          )
        );

        for (const item of rawItems) {
          if (!item.link || !allowedLinks.has(item.link)) continue;
          const normalized = normalizeUrl(item.link);
          if (!normalized) continue;

          const publishedAt = item.isoDate || item.pubDate || null;
          await enqueueUrl({
            url: normalized,
            sourceId: feed.sourceId,
            feedId: feed.id,
            publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
          });
          queued += 1;
        }
      } else if (feedType === 'sitemap' || feedType === 'sitemap_news' || feedType === 'sitemap_general') {
        const urls = await parseSitemapUrls(feed.url, { maxUrls: URLS_PER_FEED_LIMIT });
        processed += 1;
        for (const entry of urls) {
          const normalized = normalizeUrl(entry.loc);
          if (!normalized) continue;
          if (applyUrlFilters([normalized], config).length === 0) continue;
          await enqueueUrl({
            url: normalized,
            sourceId: feed.sourceId,
            feedId: feed.id,
            publishedAt: entry.lastmod ? new Date(entry.lastmod).toISOString() : null,
          });
          queued += 1;
        }
      } else if (feedType === 'html_section') {
        const urls = await scrapeHtmlLinks(feed.url, feed.config || undefined);
        processed += 1;
        for (const url of applyUrlFilters(urls, config)) {
          const normalized = normalizeUrl(url);
          if (!normalized) continue;
          await enqueueUrl({
            url: normalized,
            sourceId: feed.sourceId,
            feedId: feed.id,
            publishedAt: null,
          });
          queued += 1;
        }
      }

      // Update feed last fetched
      await feedDoc.ref.update({
        lastFetchedAt: new Date(),
        errorCount: 0,
      });
    } catch (err: any) {
      errors.push(`${feed.url}: ${err?.message || 'unknown error'}`);
      await feedDoc.ref.update({
        lastFetchedAt: new Date(),
        errorCount: (feed.errorCount || 0) + 1,
      });
    }
  }

  return Response.json({ processed, queued, errors, feedCount: feedsSnapshot.size });
}
