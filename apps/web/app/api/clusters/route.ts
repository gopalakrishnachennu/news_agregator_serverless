import { z } from 'zod';
import { getDb, COLLECTIONS } from '@/lib/firebase';

const querySchema = z.object({
  limit: z.string().optional(),
  topic: z.string().optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: searchParams.get('limit') ?? undefined,
    topic: searchParams.get('topic') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: 'Invalid query' }, { status: 400 });
  }

  const limit = Math.min(parseInt(parsed.data.limit || '20', 10), 50);
  const topic = parsed.data.topic || null;
  const db = getDb();

  let query = db.collection(COLLECTIONS.CLUSTERS)
    .orderBy('lastUpdatedAt', 'desc')
    .limit(limit);

  if (topic) {
    query = query.where('topic', '==', topic);
  }

  const snapshot = await query.get();

  const items = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
    lastUpdatedAt: doc.data().lastUpdatedAt?.toDate?.()?.toISOString() || null,
  }));

  return Response.json({ items });
}
