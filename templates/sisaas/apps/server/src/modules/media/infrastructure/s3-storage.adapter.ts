import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3Config, StoragePort } from '../domain/storage-port';

/** S3/MinIO-backed storage. Presigned PUT for uploads; server-side put/get otherwise. */
export class S3StorageAdapter implements StoragePort {
  private readonly client: S3Client;
  private readonly presignClient: S3Client;

  constructor(private readonly cfg: S3Config) {
    const shared = {
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKey,
        secretAccessKey: cfg.secretKey,
      },
      forcePathStyle: cfg.forcePathStyle,
    };
    // Internal client: server ⇄ storage over the private network.
    this.client = new S3Client({ endpoint: cfg.endpoint, ...shared });
    // Presigned URLs are handed to the browser, so they must be signed against
    // the PUBLIC endpoint (the host objects are served from). Signing with the
    // internal endpoint yields an unreachable/mixed-content URL whose sigv4 host
    // also won't match what the browser sends. Derive it from publicUrl's origin.
    let publicEndpoint = cfg.endpoint;
    try {
      publicEndpoint = new URL(cfg.publicUrl).origin;
    } catch {
      /* malformed publicUrl → fall back to the internal endpoint */
    }
    this.presignClient = new S3Client({ endpoint: publicEndpoint, ...shared });
  }

  presignUpload(key: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: 900 },
    );
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`Empty object: ${key}`);
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  publicUrl(key: string): string {
    return `${this.cfg.publicUrl}/${key}`;
  }
}
