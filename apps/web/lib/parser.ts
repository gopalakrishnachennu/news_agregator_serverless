import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';

export interface ParsedArticle {
  title: string;
  content: string;
  textContent: string;
  excerpt: string;
  author: string | null;
  publishedTime: string | null;
  canonicalUrl: string | null;
  imageCandidates: ImageCandidate[];
}

export interface ImageCandidate {
  url: string;
  sourceType: 'og' | 'twitter' | 'schema' | 'body';
  scoreModifier: number;
  referer?: string;
}

export function parseHtml(html: string, originalUrl: string): ParsedArticle {
  const doc = new JSDOM(html, { url: originalUrl });
  const reader = new Readability(doc.window.document);
  const article = reader.parse();
  const $ = cheerio.load(html);

  const candidates: ImageCandidate[] = [];

  const pushCandidate = (url: string, sourceType: ImageCandidate['sourceType'], scoreModifier: number) => {
    if (!url) return;
    candidates.push({ url, sourceType, scoreModifier, referer: originalUrl });
  };

  const pickFromSrcset = (srcset: string): string | null => {
    if (!srcset) return null;
    const parts = srcset.split(',').map((p) => p.trim()).filter(Boolean);
    let bestUrl: string | null = null;
    let bestScore = -1;
    for (const part of parts) {
      const [rawUrl, rawSize] = part.split(/\s+/);
      if (!rawUrl) continue;
      const size = rawSize || '';
      let score = 0;
      if (size.endsWith('w')) {
        const w = parseInt(size.replace('w', ''), 10);
        if (!Number.isNaN(w)) score = w;
      } else if (size.endsWith('x')) {
        const x = parseFloat(size.replace('x', ''));
        if (!Number.isNaN(x)) score = x * 1000;
      }
      if (score > bestScore) {
        bestScore = score;
        bestUrl = rawUrl;
      }
    }
    return bestUrl;
  };

  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) pushCandidate(ogImage, 'og', 1.0);
  const ogImageSecure = $('meta[property="og:image:secure_url"]').attr('content');
  if (ogImageSecure) pushCandidate(ogImageSecure, 'og', 1.0);
  const ogImageUrl = $('meta[property="og:image:url"]').attr('content');
  if (ogImageUrl) pushCandidate(ogImageUrl, 'og', 1.0);

  const twitterImage = $('meta[name="twitter:image"]').attr('content');
  if (twitterImage) pushCandidate(twitterImage, 'twitter', 0.9);
  const twitterImageSrc = $('meta[name="twitter:image:src"]').attr('content');
  if (twitterImageSrc) pushCandidate(twitterImageSrc, 'twitter', 0.9);

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).contents().text();
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const graph = node && node['@graph'];
        const graphNodes = Array.isArray(graph) ? graph : [];
        const allNodes = [node, ...graphNodes];
        for (const n of allNodes) {
          const images = (n && (n.image || n.thumbnailUrl || (n.logo && n.logo.url))) || null;
          const normalized = Array.isArray(images) ? images : images ? [images] : [];
          for (const img of normalized) {
            const url = typeof img === 'string' ? img : img?.url;
            if (url) pushCandidate(url, 'schema', 0.85);
          }
        }
      }
    } catch {
      // Ignore invalid JSON-LD blocks
    }
  });

  $('img').each((_, el) => {
    const src = $(el).attr('src');
    const dataSrc = $(el).attr('data-src') || $(el).attr('data-original') || $(el).attr('data-lazy-src');
    const srcset = $(el).attr('srcset') || $(el).attr('data-srcset');
    const srcsetUrl = srcset ? pickFromSrcset(srcset) : null;
    const candidateSrc = dataSrc || srcsetUrl || src;
    if (src && !src.includes('pixel') && !src.includes('logo')) {
      try {
        const absoluteUrl = new URL(candidateSrc || src, originalUrl).href;
        pushCandidate(absoluteUrl, 'body', 0.5);
      } catch {
        // ignore
      }
    }
  });

  const publishedTime =
    $('meta[property="article:published_time"]').attr('content') ||
    $('meta[name="pubdate"]').attr('content') ||
    null;

  return {
    title: article?.title || $('title').text() || '',
    content: article?.content || '',
    textContent: article?.textContent || '',
    excerpt: article?.excerpt || '',
    author: article?.byline || null,
    publishedTime,
    canonicalUrl: $('link[rel="canonical"]').attr('href') || originalUrl,
    imageCandidates: candidates,
  };
}
