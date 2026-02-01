import { getDb, COLLECTIONS } from './firebase';
import { FieldValue } from 'firebase-admin/firestore';

export interface QueueItem {
  id: string;
  url: string;
  sourceId: string | null;
  feedId: string | null;
  status: 'pending' | 'processing' | 'done' | 'failed';
  attempts: number;
  createdAt: Date;
  processedAt: Date | null;
  leasedAt: Date | null;
  leaseOwner: string | null;
  nextRetryAt: Date | null;
  publishedAt: Date | null;
  lastError: string | null;
}

export async function enqueueUrl(params: {
  url: string;
  sourceId?: string | null;
  feedId?: string | null;
  publishedAt?: string | null;
}): Promise<void> {
  const db = getDb();
  const queueRef = db.collection(COLLECTIONS.QUEUE);

  // Check if URL already exists
  const existing = await queueRef.where('url', '==', params.url).limit(1).get();
  if (!existing.empty) {
    return; // Already queued
  }

  await queueRef.add({
    url: params.url,
    sourceId: params.sourceId ?? null,
    feedId: params.feedId ?? null,
    status: 'pending',
    attempts: 0,
    createdAt: FieldValue.serverTimestamp(),
    processedAt: null,
    leasedAt: null,
    leaseOwner: null,
    nextRetryAt: null,
    publishedAt: params.publishedAt ? new Date(params.publishedAt) : null,
    lastError: null,
  });
}

export async function leaseBatch(limit: number, leaseOwner: string): Promise<QueueItem[]> {
  const db = getDb();
  const queueRef = db.collection(COLLECTIONS.QUEUE);
  const now = new Date();

  // Get pending or failed items ready for retry
  const snapshot = await queueRef
    .where('status', 'in', ['pending', 'failed'])
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get();

  const items: QueueItem[] = [];
  const batch = db.batch();

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // Check if ready for retry
    if (data.nextRetryAt && data.nextRetryAt.toDate() > now) {
      continue;
    }

    batch.update(doc.ref, {
      status: 'processing',
      leasedAt: FieldValue.serverTimestamp(),
      leaseOwner,
      attempts: (data.attempts || 0) + 1,
    });

    items.push({
      id: doc.id,
      url: data.url,
      sourceId: data.sourceId,
      feedId: data.feedId,
      status: 'processing',
      attempts: (data.attempts || 0) + 1,
      createdAt: data.createdAt?.toDate() || new Date(),
      processedAt: data.processedAt?.toDate() || null,
      leasedAt: now,
      leaseOwner,
      nextRetryAt: data.nextRetryAt?.toDate() || null,
      publishedAt: data.publishedAt?.toDate() || null,
      lastError: data.lastError,
    });

    if (items.length >= limit) break;
  }

  if (items.length > 0) {
    await batch.commit();
  }

  return items;
}

export async function markDone(id: string): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTIONS.QUEUE).doc(id).update({
    status: 'done',
    processedAt: FieldValue.serverTimestamp(),
    leaseOwner: null,
    leasedAt: null,
    lastError: null,
  });
}

export async function markFailed(id: string, error: string, retryDelayMinutes = 10): Promise<void> {
  const db = getDb();
  const nextRetryAt = new Date(Date.now() + retryDelayMinutes * 60 * 1000);

  await db.collection(COLLECTIONS.QUEUE).doc(id).update({
    status: 'failed',
    lastError: error.slice(0, 2000),
    leaseOwner: null,
    leasedAt: null,
    nextRetryAt,
  });
}
