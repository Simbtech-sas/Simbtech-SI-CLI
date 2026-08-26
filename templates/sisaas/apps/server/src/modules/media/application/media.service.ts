import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STORAGE_PORT, type StoragePort } from '../domain/storage-port';

/** Accepted uploads → the extension the original is stored under. */
const UPLOAD_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

interface CreateUploadInput {
  contentType: string;
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  /** Hand back a presigned URL so the client uploads the original directly to storage. */
  async createUpload(tenantId: string, input: CreateUploadInput) {
    const ext = UPLOAD_CONTENT_TYPES[input.contentType];
    if (!ext) throw new BadRequestException('Unsupported content type');
    const objectId = randomUUID();
    const key = `tenants/${tenantId}/uploads/${objectId}/original.${ext}`;
    const uploadUrl = await this.storage.presignUpload(key, input.contentType);
    return { key, uploadUrl, publicUrl: this.storage.publicUrl(key) };
  }

  /** Public URL an uploaded object is served from. */
  publicUrl(key: string): string {
    return this.storage.publicUrl(key);
  }
}
