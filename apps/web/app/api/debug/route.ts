import { getDb } from '@/lib/firebase';

export async function GET() {
    try {
        const db = getDb();

        // Test connection by reading a collection
        const testRef = db.collection('_health_check');
        await testRef.doc('test').set({
            timestamp: new Date().toISOString(),
            status: 'ok'
        });

        const doc = await testRef.doc('test').get();

        return Response.json({
            status: 'ok',
            firebase: 'connected',
            data: doc.data(),
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.slice(0, 20) + '...',
            hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
            privateKeyLength: process.env.FIREBASE_PRIVATE_KEY?.length,
            adminSecretSet: !!process.env.ADMIN_SECRET,
        });
    } catch (error: any) {
        return Response.json({
            status: 'error',
            error: error.message,
            stack: error.stack?.slice(0, 500),
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.slice(0, 20) + '...',
            hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
            privateKeyLength: process.env.FIREBASE_PRIVATE_KEY?.length,
            adminSecretSet: !!process.env.ADMIN_SECRET,
        }, { status: 500 });
    }
}
