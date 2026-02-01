import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let app: App;
let db: Firestore;

function getFirebaseApp(): App {
    if (getApps().length > 0) {
        return getApps()[0];
    }

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
        throw new Error('Firebase credentials not configured');
    }

    app = initializeApp({
        credential: cert({
            projectId,
            clientEmail,
            privateKey,
        }),
    });

    return app;
}

export function getDb(): Firestore {
    if (!db) {
        getFirebaseApp();
        db = getFirestore();
    }
    return db;
}

// Collection names
export const COLLECTIONS = {
    SOURCES: 'sources',
    FEEDS: 'feeds',
    ARTICLES: 'articles',
    CLUSTERS: 'clusters',
    QUEUE: 'queue',
    SETTINGS: 'settings',
} as const;
