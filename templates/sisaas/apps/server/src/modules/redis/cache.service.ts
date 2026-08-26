import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS_CLIENT');

/**
 * Thin JSON cache over Redis. Every operation degrades gracefully: if Redis is
 * unconfigured or unreachable, reads miss and writes no-op — the app never breaks
 * because of the cache.
 */
@Injectable()
export class CacheService {
  constructor(
    @Optional() @Inject(REDIS) private readonly redis: Redis | null,
  ) {}

  get enabled(): boolean {
    return this.redis !== null;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* ignore cache write failures */
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.redis || keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch {
      /* ignore */
    }
  }
}
