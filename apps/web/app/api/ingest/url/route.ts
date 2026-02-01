import { z } from 'zod';
import { enqueueUrl } from '@/lib/queue';
import { normalizeUrl } from '@/lib/url';

const schema = z.object({
  url: z.string().url(),
  sourceId: z.string().optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 });
  }

  const normalized = normalizeUrl(parsed.data.url);
  await enqueueUrl({ url: normalized, sourceId: parsed.data.sourceId ?? null });

  return Response.json({ status: 'queued', url: normalized });
}
