import { z } from 'zod';
import { getDb, COLLECTIONS } from '@/lib/firebase';

const querySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: searchParams.get('limit') ?? undefined,
    cursor: searchParams.get('cursor') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: 'Invalid query' }, { status: 400 });
  }

  const limit = Math.min(parseInt(parsed.data.limit || '20', 10), 50);
  const db = getDb();

  let query = db.collection(COLLECTIONS.ARTICLES)
    .orderBy('createdAt', 'desc')
    .limit(limit);

  if (parsed.data.cursor) {
    const cursorDate = new Date(parsed.data.cursor);
    query = query.where('createdAt', '<', cursorDate);
  }

  const snapshot = await query.get();

  const items = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
    publishedAt: doc.data().publishedAt?.toDate?.()?.toISOString() || null,
  }));

  return Response.json({ items });
}
