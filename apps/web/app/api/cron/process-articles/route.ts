import { randomUUID } from 'node:crypto';
import { assertCronAuth } from '@/lib/cron';
import { fetchPage } from '@/lib/fetcher';
import { parseHtml } from '@/lib/parser';
import { pickBestImage } from '@/lib/images';
import { saveArticle } from '@/lib/indexer';
import { leaseBatch, markDone, markFailed } from '@/lib/queue';
import { storeImageFromUrl } from '@/lib/storage';

const BATCH_LIMIT = parseInt(process.env.QUEUE_BATCH_LIMIT || '5', 10);

export async function GET(request: Request) {
  try {
    assertCronAuth(request);
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const leaseOwner = randomUUID();
  const items = await leaseBatch(BATCH_LIMIT, leaseOwner);

  let processed = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const item of items) {
    try {
      const html = await fetchPage(item.url);
      if (!html) {
        await markFailed(item.id, 'Fetch failed');
        continue;
      }

      const parsed = parseHtml(html, item.url);
      if (!parsed.title) {
        await markFailed(item.id, 'Empty title after parsing');
        continue;
      }

      let bestImage = pickBestImage(parsed.imageCandidates);
      if (bestImage) {
        const storedUrl = await storeImageFromUrl(bestImage.url);
        if (storedUrl) {
          bestImage = { ...bestImage, url: storedUrl };
        }
      }

      await saveArticle({
        originalUrl: parsed.canonicalUrl || item.url,
        title: parsed.title,
        excerpt: parsed.excerpt,
        author: parsed.author,
        publishedTime: parsed.publishedTime || (item.publishedAt?.toISOString() ?? null),
        sourceId: item.sourceId ?? null,
        bestImage: bestImage
          ? {
            url: bestImage.url,
            width: bestImage.width,
            height: bestImage.height,
            score: bestImage.score,
          }
          : null,
      });

      await markDone(item.id);
      processed += 1;
    } catch (err: any) {
      const message = err?.message || 'unknown error';
      errors.push({ id: item.id, error: message });
      await markFailed(item.id, message);
    }
  }

  return Response.json({ leased: items.length, processed, errors });
}
