export function normalizeUrl(raw: string): string {
  if (!raw) return '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    try {
      url = new URL(`http://${raw}`);
    } catch {
      return raw;
    }
  }

  // Remove tracking params
  const params = url.searchParams;
  for (const key of Array.from(params.keys())) {
    if (key.startsWith('utm_')) {
      params.delete(key);
    }
  }
  ['fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid'].forEach((key) => params.delete(key));

  // Normalize AMP
  if (url.hostname.startsWith('amp.')) {
    url.hostname = url.hostname.slice(4);
  }
  if (url.pathname !== '/') {
    if (url.pathname.endsWith('/amp')) {
      url.pathname = url.pathname.slice(0, -4);
    } else if (url.pathname.endsWith('/amp/')) {
      url.pathname = `${url.pathname.slice(0, -5)}/`;
    }
  }
  params.delete('amp');

  url.search = params.toString();
  return url.toString();
}
