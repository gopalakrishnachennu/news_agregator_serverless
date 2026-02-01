import { assertAdminAuth } from '@/lib/admin';
import { getDb, COLLECTIONS } from '@/lib/firebase';

export async function GET(request: Request) {
  try {
    assertAdminAuth(request);
  } catch (err: any) {
    return new Response(err?.message || 'Unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const limitRaw = searchParams.get('limit');
  const limit = Math.min(parseInt(limitRaw || '50', 10), 200);

  const db = getDb();
  let query = db.collection(COLLECTIONS.QUEUE)
    .orderBy('createdAt', 'desc')
    .limit(limit);

  if (status) {
    query = query.where('status', '==', status);
  }

  const snapshot = await query.get();

  const items = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
    processedAt: doc.data().processedAt?.toDate?.()?.toISOString() || null,
    leasedAt: doc.data().leasedAt?.toDate?.()?.toISOString() || null,
    nextRetryAt: doc.data().nextRetryAt?.toDate?.()?.toISOString() || null,
    publishedAt: doc.data().publishedAt?.toDate?.()?.toISOString() || null,
  }));

  return Response.json({ items });
}
