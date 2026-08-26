import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Standalone background-worker process. Owns the BullMQ consumers and stays alive
 * on the Redis connection. Deploy as a SEPARATE process from the API
 * (`node dist/src/worker.main`) so API restarts/deploys don't drop jobs.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.enableShutdownHooks();
  Logger.log('Worker started', 'Bootstrap');
}

void bootstrap();
