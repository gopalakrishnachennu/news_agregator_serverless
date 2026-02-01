import { assertAdminAuth } from '@/lib/admin';
import { getDb, COLLECTIONS } from '@/lib/firebase';

export async function POST(request: Request) {
  try {
    assertAdminAuth(request);
  } catch (err: any) {
    return new Response(err?.message || 'Unauthorized', { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const id = body?.id;
  if (!id || typeof id !== 'string') {
    return Response.json({ error: 'Invalid id' }, { status: 400 });
  }

  const db = getDb();
  await db.collection(COLLECTIONS.QUEUE).doc(id).update({
    status: 'pending',
    nextRetryAt: null,
    leaseOwner: null,
    leasedAt: null,
  });

  return Response.json({ status: 'ok', id });
}
