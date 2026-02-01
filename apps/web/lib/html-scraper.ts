import * as cheerio from 'cheerio';

const DEFAULT_USER_AGENT = 'NewsAggregatorBot/1.0 (+https://example.com/bot)';

export interface HtmlScrapeConfig {
  selector?: string;
  url_pattern?: string;
  deny_pattern?: string;
}

export async function scrapeHtmlLinks(url: string, config?: HtmlScrapeConfig): Promise<string[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const selector = config?.selector || 'a';

    const urlPattern = config?.url_pattern ? new RegExp(config.url_pattern) : null;
    const denyPattern = config?.deny_pattern ? new RegExp(config.deny_pattern) : null;

    const urls = new Set<string>();

    $(selector).each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const absolute = new URL(href, url).toString();
        if (denyPattern && denyPattern.test(absolute)) return;
        if (urlPattern && !urlPattern.test(absolute)) return;
        urls.add(absolute);
      } catch {
        // ignore invalid
      }
    });

    return Array.from(urls);
  } catch (err) {
    console.error('Failed to scrape html section:', url, err);
    return [];
  }
}
