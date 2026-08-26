import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { CacheService, REDIS } from './cache.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Redis | null => {
        const url = config.redisUrl;
        if (!url) return null;
        const client = new Redis(url, {
          maxRetriesPerRequest: 2,
          lazyConnect: false,
        });
        // Swallow connection errors — CacheService degrades to a no-op.
        client.on('error', () => undefined);
        return client;
      },
    },
    CacheService,
  ],
  exports: [CacheService, REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }
}
