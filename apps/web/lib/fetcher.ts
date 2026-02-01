const USER_AGENT = 'NewsAggregatorBot/1.0 (+https://example.com/bot)';

export async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return null;
    }

    return await res.text();
  } catch (err) {
    console.error(`Failed to fetch ${url}:`, err);
    return null;
  }
}
