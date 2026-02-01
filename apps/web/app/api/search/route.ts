import { z } from 'zod';
import { getDb, COLLECTIONS } from '@/lib/firebase';

const querySchema = z.object({
  q: z.string().min(1),
  limit: z.string().optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: searchParams.get('q') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: 'Missing query' }, { status: 400 });
  }

  const limit = Math.min(parseInt(parsed.data.limit || '20', 10), 50);
  const q = parsed.data.q.toLowerCase();
  const db = getDb();

  // Firestore doesn't support full-text search natively
  // We'll fetch recent articles and filter client-side
  // For production, consider using Algolia or Typesense
  const snapshot = await db.collection(COLLECTIONS.ARTICLES)
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();

  const items = snapshot.docs
    .map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title || '',
        snippet: data.snippet || '',
        url: data.url || '',
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        publishedAt: data.publishedAt?.toDate?.()?.toISOString() || null,
      };
    })
    .filter(item => {
      const title = item.title.toLowerCase();
      const snippet = item.snippet.toLowerCase();
      return title.includes(q) || snippet.includes(q);
    })
    .slice(0, limit);

  return Response.json({ items });
}
