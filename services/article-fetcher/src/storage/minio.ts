import { Client } from 'minio';
import * as crypto from 'crypto';

export class HtmlStorage {
    private minioClient: Client;
    private bucketName: string;
    private bucketReady: Promise<void>;

    constructor() {
        this.minioClient = new Client({
            endPoint: process.env.MINIO_ENDPOINT || 'localhost',
            port: parseInt(process.env.MINIO_PORT || '9000'),
            useSSL: false,
            accessKey: process.env.MINIO_ACCESS_KEY || 'minio_user',
            secretKey: process.env.MINIO_SECRET_KEY || 'minio_password',
        });
        this.bucketName = process.env.MINIO_BUCKET || 'raw-articles';
        this.bucketReady = this.ensureBucket();
    }

    private async ensureBucket() {
        try {
            const exists = await this.minioClient.bucketExists(this.bucketName);
            if (!exists) {
                await this.minioClient.makeBucket(this.bucketName, 'us-east-1');
                console.log(`Bucket ${this.bucketName} created.`);
            }
        } catch (err) {
            console.error('Error ensuring bucket exists:', err);
        }
    }

    async saveHtml(url: string, html: string): Promise<string> {
        // Create a hashed filename to avoid issues with URL characters
        const hash = crypto.createHash('sha256').update(url).digest('hex');
        const objectName = `${hash}.html`;

        try {
            await this.bucketReady;
            await this.minioClient.putObject(
                this.bucketName,
                objectName,
                Buffer.from(html),
                html.length,
                { 'Content-Type': 'text/html' }
            );
            return objectName;
        } catch (err) {
            console.error(`Failed to upload ${objectName}:`, err);
            throw err;
        }
    }
}
