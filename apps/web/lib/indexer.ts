import { getDb, COLLECTIONS } from './firebase';
import { FieldValue } from 'firebase-admin/firestore';

export interface ArticleInput {
  originalUrl: string;
  title: string;
  excerpt?: string;
  author?: string | null;
  publishedTime?: string | null;
  sourceId?: string | null;
  bestImage?: { url: string; width?: number | null; height?: number | null; score?: number | null } | null;
}

// Simple text similarity (Jaccard similarity on words)
function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

export async function saveArticle(data: ArticleInput): Promise<void> {
  const db = getDb();

  // Check if article already exists
  const existingArticle = await db.collection(COLLECTIONS.ARTICLES)
    .where('url', '==', data.originalUrl)
    .limit(1)
    .get();

  if (!existingArticle.empty) {
    return; // Already exists
  }

  // Find similar cluster by title (within last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentClusters = await db.collection(COLLECTIONS.CLUSTERS)
    .where('lastUpdatedAt', '>', oneDayAgo)
    .orderBy('lastUpdatedAt', 'desc')
    .limit(50)
    .get();

  let clusterId: string | null = null;
  let bestSimilarity = 0;

  for (const clusterDoc of recentClusters.docs) {
    const clusterData = clusterDoc.data();
    const similarity = textSimilarity(data.title, clusterData.title || '');

    if (similarity > 0.4 && similarity > bestSimilarity) {
      bestSimilarity = similarity;
      clusterId = clusterDoc.id;
    }
  }

  // Create new cluster if no match
  if (!clusterId) {
    const clusterRef = await db.collection(COLLECTIONS.CLUSTERS).add({
      title: data.title,
      topic: 'general',
      score: 10.0,
      createdAt: FieldValue.serverTimestamp(),
      lastUpdatedAt: FieldValue.serverTimestamp(),
      primaryArticleId: null,
    });
    clusterId = clusterRef.id;
  } else {
    // Update cluster timestamp
    await db.collection(COLLECTIONS.CLUSTERS).doc(clusterId).update({
      lastUpdatedAt: FieldValue.serverTimestamp(),
    });
  }

  // Save article
  const articleRef = await db.collection(COLLECTIONS.ARTICLES).add({
    clusterId,
    sourceId: data.sourceId ?? null,
    url: data.originalUrl,
    title: data.title,
    snippet: data.excerpt ? data.excerpt.substring(0, 200) : '',
    publishedAt: data.publishedTime ? new Date(data.publishedTime) : FieldValue.serverTimestamp(),
    author: data.author ?? null,
    bestImageUrl: data.bestImage?.url ?? null,
    bestImageWidth: data.bestImage?.width ?? 0,
    bestImageHeight: data.bestImage?.height ?? 0,
    imageQualityScore: data.bestImage?.score ?? 0,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Set as primary article if new cluster
  if (bestSimilarity === 0) {
    await db.collection(COLLECTIONS.CLUSTERS).doc(clusterId).update({
      primaryArticleId: articleRef.id,
    });
  }
}
