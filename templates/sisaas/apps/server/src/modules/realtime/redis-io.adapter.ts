import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter backed by Redis pub/sub so events fan out across every
 * server instance (required once we run more than one node). Falls back to the
 * in-memory adapter when REDIS_URL is unset or the optional `@socket.io/redis-adapter`
 * package isn't installed (single-node dev).
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ((nsp: unknown) => unknown) | null = null;

  /** Connect pub/sub clients. Returns false if unavailable (caller keeps default). */
  async connect(url: string): Promise<boolean> {
    try {
      // Optional dep — installed in prod, dynamically loaded so dev works without it.
      // @ts-ignore — module is an optionalDependency, absent in local dev.
      const { createAdapter } = (await import('@socket.io/redis-adapter')) as {
        createAdapter: (pub: Redis, sub: Redis) => (nsp: unknown) => unknown;
      };
      const pub = new Redis(url, { lazyConnect: false });
      const sub = pub.duplicate();
      this.adapterConstructor = createAdapter(pub, sub);
      this.logger.log('Socket.IO Redis adapter active (multi-node fan-out)');
      return true;
    } catch (err) {
      this.logger.warn(
        `Redis adapter unavailable (${err instanceof Error ? err.message : err}); using single-node adapter`,
      );
      return false;
    }
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as {
      adapter: (c: unknown) => void;
    };
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
