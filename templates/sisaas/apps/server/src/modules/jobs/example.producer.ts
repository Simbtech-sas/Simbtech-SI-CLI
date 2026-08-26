import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EXAMPLE_QUEUE } from './jobs.constants';

/** Enqueues jobs onto the example queue. Inject this wherever you need async work. */
@Injectable()
export class ExampleProducer {
  constructor(@InjectQueue(EXAMPLE_QUEUE) private readonly queue: Queue) {}

  enqueue(message: string): Promise<unknown> {
    return this.queue.add('example-job', { message });
  }
}
