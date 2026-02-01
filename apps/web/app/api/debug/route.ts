import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export async function GET() {
    const HARDCODED_CREDS = {
        projectId: "news-agg-880da",
        clientEmail: "firebase-adminsdk-fbsvc@news-agg-880da.iam.gserviceaccount.com",
        privateKey: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7d/t2HeUnkFch\nwXuS+V498V8Kb+g/Nb9P1hwWxxwcU1no1kSwvUprPJZ7scg+yWTq7ntx5rVYyRUA\nXQ6ViL8KtQEdCmjeJn22xgGt/rveBIZcA79WFv6FOvqo5Qn0c0G/W/zJ77Srn/t8\nMbvO2V3FShq3umPUMfRgi8x9ezrSUFRaxmqeKfQ3FmjNTUAzhp0A9Niq9OEWRFoM\nzuSfn2EjeJL3jRDQhTOaTIgkWkJy07vkCP1poAp5uLCZo4ABgq5lJ3exJOJblB+Z\n+5gF3bShsucUxh8GOVCPlNI/ULgiWBBTXWTFgqCZanbvdBdz75mH8G8Gfc3FaEIN\n401NbWzHAgMBAAECggEAQQDjCDtofJX/qHxDAZ0HMRpTVrakBNr5qdC3r6w90pKS\nT/qQGeqg9dst4Nkt8pt5qz6jPkT9p7od1qDt0Cr491j4+F1mLHWTTL+O0IrOELdn\n8Vr5SvwxJ/hh9xNoJsOaTiSy3ECKWKJiHNfP4/MaITFHX2K5f9gMgTeoYfBLXqYU\nnqI+HJe7LCKZEZ+wQr9SSJTO893QD82apPhJCXz/jKXBYI2xwslB2+DDj3XUghMm\nFF7X/iOvJ5RLPF/7LAp72bk69IOIOAscAKg1xovt01Vve54b4T+2h6nYtTXSx2sE\nlDEPkGVMcYy+p6mkAKSwaDxJYSxkuSfsKbLshLv2YQKBgQDs2dtveVQFmgiwF8C2\nVJbwBHDuDCv9nEfmcZLVg23OUKE30hqhhd45ni8vHufmTCVfa8V2m1s0BhoTB3yM\nMlKtzj7v0CtbmHF9djnMyOoUHG3RkEa4FakKT5uE5ITP6wRP6Jh6kcul76c5hg3d\nSQ8n8BtWH+bznY+qplFn/T8m5wKBgQDKoA0ih4zfhmg7GneJGwN3+P5r4gCRiVg4\nTIqHJS7aPpL/Wj88VqqkSZ/qA/A6dRptnwApQ45s6iYYUQe8SaVgoU4rrLKosVUR\nY0wFUzoFKZhNrjTo69NPv3ztodR5evvQbDzdnQq7v2sQQWjYNMsyWDEvTWkwa3E6\nX61yyxMvIQKBgQCjSMnz/uQC/J8yrx1nVce87oLgSbnmHGChKPk+g14nFwUeE5XS\ndxSuCjSjOp5K8YHuV8EJNK9anT5KkiW2DVdchUx0TcImYmETSncsi/J8LOE00U8/\nx4cDGcCwjE5XfME7SbIdBfgsjJxvltBmFuEA+pIN/O5eUuhhkEmc9EUeTwKBgFsE\nwEG1gAtcde+uuOlmsA0xVSAi+jxl5LINd+CzTDOPDjsUT/mLuMVpqSLWuA+aUM/T\nL6BZj13PZGNh6saikl4wt0uZHPv4BI11/E0cEKEHCTpDudKzNE3LZ5PbMPWM0BbU\nuBaYl5y0pKQ9rZoJRQmNYjKsZEbyzH77QY+iNzDhAoGAD7mhm3jmmRANj/1EoFWn\ntjsUMz1OzX3cd8RP+MeOQTaHFx5dYJW80rVs+25JqmeDM4BGfhDAYAnD2NkWO+Lc\nQBxmtwNrEKtcELQHdoFqBN+Nwv0NBzDOzjm5NBo517sqqBjjiFm/NHPKaNyRBslH\nHUiQewTGXD+WuDi/wSybAdI=\n-----END PRIVATE KEY-----\n"
    };

    try {
        // Create a unique app name to avoid conflict with default app
        // Use the hardcoded creds directly
        const appName = 'debug-app-' + Date.now();
        const app = initializeApp({
            credential: cert(HARDCODED_CREDS),
        }, appName);

        const db = getFirestore(app);

        // Test connection by reading a collection
        const testRef = db.collection('_health_check');
        await testRef.doc('test').set({
            timestamp: new Date().toISOString(),
            status: 'ok_hardcoded'
        });

        return Response.json({
            status: 'ok',
            msg: 'Hardcoded creds worked!',
        });
    } catch (error: any) {
        return Response.json({
            status: 'error',
            msg: 'Hardcoded creds FAILED',
            error: error.message,
        }, { status: 500 });
    }
}
