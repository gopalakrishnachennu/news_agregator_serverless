import { put } from '@vercel/blob';
import { env } from './env';

function extensionFromContentType(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  return 'bin';
}

export async function storeImageFromUrl(url: string) {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    return null;
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    return null;
  }

  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const buffer = await res.arrayBuffer();
  const ext = extensionFromContentType(contentType);
  const key = `images/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const blob = await put(key, Buffer.from(buffer), {
    access: 'public',
    contentType,
    token: env.BLOB_READ_WRITE_TOKEN,
  });

  return blob.url;
}
