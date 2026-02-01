import { getDb } from '@/lib/firebase';

export async function GET() {
    const pk = process.env.FIREBASE_PRIVATE_KEY || '';
    let decodedPreview = 'none';
    let decodeError = null;

    try {
        if (pk && !pk.includes('-----BEGIN')) {
            const buf = Buffer.from(pk, 'base64');
            decodedPreview = buf.toString('utf-8').slice(0, 30);
        }
    } catch (e: any) {
        decodeError = e.message;
    }

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
            privateKeyLength: pk.length,
            decodeTest: decodedPreview,
            decodeError: decodeError,
            adminSecretSet: !!process.env.ADMIN_SECRET,
        });
    } catch (error: any) {
        return Response.json({
            status: 'error',
            error: error.message,
            projectId: process.env.FIREBASE_PROJECT_ID,
            privateKeyLength: pk.length,
            decodeTest: decodedPreview,
            decodeError: decodeError,
            adminSecretSet: !!process.env.ADMIN_SECRET,
        }, { status: 500 });
    }
}
