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
    // Handle Base64 encoded private key (to avoid Vercel newline issues)
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey && !privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        try {
            const buffer = Buffer.from(privateKey, 'base64');
            privateKey = buffer.toString('utf-8');
        } catch (e) {
            // ignore error, might be just a wrong key
        }
    }

    if (privateKey) {
        // If the key contains literal \n strings, replace them with actual newlines
        if (privateKey.includes('\\n')) {
            privateKey = privateKey.replace(/\\n/g, '\n');
        }
        // Remove any trailing whitespace
        privateKey = privateKey.trim();
    }

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
