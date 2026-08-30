// The single-tenant application root. Identical to the multi-tenant one
// except that TenancyModule is absent — there is no tenant to resolve.
//
// A variant rather than a marker: the tenancy module is conditional on the
// PROFILE (mono/service keep it, identity does not) *and* on tenancy, and one
// marker cannot express an AND.
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/app-config.service';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './modules/events/events.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { RedisModule } from './modules/redis/redis.module';
import { SecurityModule } from './modules/security/security.module';
import { WidgetsModule } from './modules/widgets/widgets.module';
import { AuditModule } from './modules/audit/audit.module';

/**
 * The worker process's root module. It boots ONLY the infrastructure a
 * background consumer needs (config, DB, Redis, BullMQ) plus the job modules —
 * no HTTP layer. Run it with `pnpm worker`. Deploying the worker separately from
 * the API means API restarts never drop in-flight jobs.
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    SecurityModule,
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const url = config.redisUrl;
        const u = url ? new URL(url) : null;
        return {
          connection: {
            host: u?.hostname ?? 'localhost',
            port: u && u.port ? Number(u.port) : 6379,
            password: u?.password || undefined,
          },
        };
      },
    }),
    // The worker owns event consumption and the outbox prune schedule.
    ScheduleModule.forRoot(),
    EventsModule.forRoot({ consume: true, transport: 'in-process' }), // si:profile mono
    EventsModule.forRoot({ consume: true, transport: 'kafka' }), // si:profile identity,service
    JobsModule,
    // Feature modules must be imported HERE too, or their event handlers never
    // register and the consumer subscribes to nothing. Controllers they declare
    // are inert in an application context.
    // @Global, and a global module still has to be imported into the graph it is
    // global to. The worker is a SEPARATE Nest application, so leaving this out
    // means anything here that audits fails to resolve — at boot, not at build.
    AuditModule,
    WidgetsModule,
    // si:modules
  ],
})
export class WorkerModule {}
