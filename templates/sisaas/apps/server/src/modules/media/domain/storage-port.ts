export interface S3Config {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  forcePathStyle: boolean;
  publicUrl: string;
}

/** Object storage abstraction (S3/MinIO in prod; in-memory stub in dev/tests). */
export interface StoragePort {
  /** A short-lived presigned PUT URL so the client uploads straight to storage. */
  presignUpload(key: string, contentType: string): Promise<string>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Public URL used to serve an object. */
  publicUrl(key: string): string;
}

export const STORAGE_PORT = Symbol('STORAGE_PORT');
