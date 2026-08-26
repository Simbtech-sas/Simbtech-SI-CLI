import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EXAMPLE_QUEUE } from './jobs.constants';

/**
 * Example background consumer. In production this runs in the separate worker
 * process (`pnpm worker`), not the API — see worker.module.ts. Replace the body
 * with real work (emails, exports, webhooks, …).
 */
@Processor(EXAMPLE_QUEUE)
export class ExampleProcessor extends WorkerHost {
  private readonly logger = new Logger(ExampleProcessor.name);

  async process(job: Job<{ message: string }>): Promise<void> {
    this.logger.log(`processing ${job.name}#${job.id}: ${job.data.message}`);
  }
}
