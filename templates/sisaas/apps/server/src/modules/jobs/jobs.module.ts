import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ExampleProcessor } from './example.processor';
import { ExampleProducer } from './example.producer';
import { EXAMPLE_QUEUE } from './jobs.constants';

/**
 * Wires the example queue's producer + processor. Imported by BOTH the API
 * (app.module — to enqueue) and the worker (worker.module — to process). In a
 * real split you'd register the processor only in the worker; keeping both here
 * is fine for a single-process dev setup.
 */
@Module({
  imports: [BullModule.registerQueue({ name: EXAMPLE_QUEUE })],
  providers: [ExampleProducer, ExampleProcessor],
  exports: [ExampleProducer],
})
export class JobsModule {}
