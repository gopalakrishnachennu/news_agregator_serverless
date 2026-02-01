const DEFAULT_USER_AGENT = 'NewsAggregatorBot/1.0 (+https://example.com/bot)';

export interface SitemapEntry {
  loc: string;
  lastmod?: string | null;
}

function extractLocs(xml: string): string[] {
  const locs: string[] = [];
  const regex = /<loc>([^<]+)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const raw = match[1].trim();
    if (raw) locs.push(raw);
  }
  return locs;
}

function extractUrlEntries(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const regex = /<url>([\s\S]*?)<\/url>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const block = match[1];
    const locMatch = /<loc>([^<]+)<\/loc>/i.exec(block);
    if (!locMatch) continue;
    const loc = locMatch[1].trim();
    if (!loc) continue;
    const lastmodMatch = /<lastmod>([^<]+)<\/lastmod>/i.exec(block);
    const lastmod = lastmodMatch ? lastmodMatch[1].trim() : null;
    entries.push({ loc, lastmod: lastmod || null });
  }
  return entries;
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.error('Failed to fetch sitemap:', url, err);
    return null;
  }
}

export async function parseSitemapUrls(url: string, options?: { maxUrls?: number; maxIndexes?: number }) {
  const maxUrls = options?.maxUrls ?? 200;
  const maxIndexes = options?.maxIndexes ?? 5;

  const xml = await fetchXml(url);
  if (!xml) return [];

  const isIndex = xml.includes('<sitemapindex');
  if (!isIndex) {
    return extractUrlEntries(xml).slice(0, maxUrls);
  }

  const sitemapLocs = extractLocs(xml).slice(0, maxIndexes);
  const urls: SitemapEntry[] = [];
  for (const loc of sitemapLocs) {
    if (urls.length >= maxUrls) break;
    const childXml = await fetchXml(loc);
    if (!childXml) continue;
    const childEntries = extractUrlEntries(childXml);
    for (const childEntry of childEntries) {
      urls.push(childEntry);
      if (urls.length >= maxUrls) break;
    }
  }

  return urls;
}
