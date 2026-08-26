import type { StoragePort } from '../domain/storage-port';

/**
 * In-memory storage used when S3/MinIO isn't configured (dev/CI/tests). Tests
 * inject the "uploaded" object via `put()`, then read it back.
 */
export class InMemoryStorageAdapter implements StoragePort {
  private readonly store = new Map<string, Buffer>();

  presignUpload(key: string): Promise<string> {
    return Promise.resolve(`memory://upload/${key}`);
  }

  put(key: string, body: Buffer): Promise<void> {
    this.store.set(key, body);
    return Promise.resolve();
  }

  get(key: string): Promise<Buffer> {
    const body = this.store.get(key);
    if (!body) return Promise.reject(new Error(`Object not found: ${key}`));
    return Promise.resolve(body);
  }

  publicUrl(key: string): string {
    return `memory://public/${key}`;
  }
}
