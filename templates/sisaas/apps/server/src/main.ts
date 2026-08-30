import fastifyCookie from '@fastify/cookie';
import fastifyCompress from '@fastify/compress';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';

const cast = (x: unknown) =>
  x as Parameters<NestFastifyApplication['register']>[0];

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      // An oversized body is consumed before any guard can run, so this is the
      // cheapest place to reject one. 1MB is Fastify's default; setting it
      // explicitly makes it a decision. Uploads go straight to S3 through a
      // presigned URL and never pass through here.
      bodyLimit: 1_048_576,
    }),
    {
      // Preserve the raw request body so provider webhooks can be verified
      // against the exact bytes received (HMAC).
      rawBody: true,
      logger: isProd
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug'],
    },
  );

  // Multi-node socket fan-out via Redis when configured; else single-node.
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const redisAdapter = new RedisIoAdapter(app);
    if (await redisAdapter.connect(redisUrl)) {
      app.useWebSocketAdapter(redisAdapter);
    } else {
      app.useWebSocketAdapter(new IoAdapter(app));
    }
  } else {
    app.useWebSocketAdapter(new IoAdapter(app));
  }

  // Cookies (httpOnly refresh token).
  await app.register(cast(fastifyCookie));

  // Security headers.
  await app.register(cast(fastifyHelmet), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https:'],
        frameAncestors: ["'none'"],
      },
    },
    hsts: isProd
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
    crossOriginEmbedderPolicy: false,
  });

  // An explicit body limit. Fastify defaults to 1MB, but a default is not a
  // decision — and an oversized body is consumed before any guard runs, so this
  // is the only place it can be rejected cheaply. File uploads go straight to S3
  // via a presigned URL and never pass through here.
  // (Applied at server construction; see bodyLimit in the adapter options below.)

  // Compression + rate limiting. Credential endpoints add a much stricter,
  // Redis-backed throttle of their own — see LoginThrottleGuard.
  await app.register(cast(fastifyCompress), { global: true });
  await app.register(cast(fastifyRateLimit), {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });

  // si:when-begin multi-tenant
  // CORS — reflect the apex and every subdomain under ROOT_DOMAIN in prod (the
  // web app is served from many tenant/role origins that all call this API).
  // si:when-end
  // CORS — reflect the apex and every subdomain under ROOT_DOMAIN in prod. // si:when single-tenant
  const rootDomain = process.env.ROOT_DOMAIN ?? 'simbkit.local';
  const corsOrigin = isProd
    ? (
        origin: string | undefined,
        cb: (err: Error | null, allow: boolean) => void,
      ) => {
        if (!origin) return cb(null, true);
        try {
          const { hostname, protocol } = new URL(origin);
          const allow =
            protocol === 'https:' &&
            (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`));
          return cb(null, allow);
        } catch {
          return cb(null, false);
        }
      }
    : true;
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.listen(process.env.PORT ?? 8080, '0.0.0.0');
}

void bootstrap();
