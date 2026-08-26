import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { AuthModule } from '../auth/auth.module';
import { MediaService } from './application/media.service';
import { STORAGE_PORT } from './domain/storage-port';
import { InMemoryStorageAdapter } from './infrastructure/in-memory-storage.adapter';
import { S3StorageAdapter } from './infrastructure/s3-storage.adapter';
import { MediaController } from './interface/media.controller';

@Module({
  imports: [AuthModule], // token verification only — no user store
  controllers: [MediaController],
  providers: [
    {
      // S3/MinIO when configured; otherwise an in-memory stub (dev/CI/tests).
      provide: STORAGE_PORT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        config.s3
          ? new S3StorageAdapter(config.s3)
          : new InMemoryStorageAdapter(),
    },
    MediaService,
  ],
  exports: [STORAGE_PORT, MediaService],
})
export class MediaModule {}
