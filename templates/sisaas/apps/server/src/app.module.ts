import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/app-config.service';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { EventsModule } from './modules/events/events.module';
import { IamModule } from './modules/iam/iam.module'; // si:when auth-builtin
import { JobsModule } from './modules/jobs/jobs.module';
import { MediaModule } from './modules/media/media.module'; // si:when storage-s3
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RedisModule } from './modules/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { SecurityModule } from './modules/security/security.module';
import { WidgetsModule } from './modules/widgets/widgets.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    // BullMQ connection shared by every registered queue.
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
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    // Cross-cutting infrastructure.
    AuditModule,
    AuthModule,
    SecurityModule,
    EventsModule.forRoot({ consume: false, transport: 'in-process' }), // si:profile mono
    EventsModule.forRoot({ consume: false, transport: 'kafka' }), // si:profile identity,service
    IamModule, // si:when auth-builtin
    MediaModule, // si:when storage-s3
    RealtimeModule,
    JobsModule,
    // Feature modules — add yours here.
    WidgetsModule,
    // si:modules
  ],
  controllers: [AppController],
  // Global zod validation: every DTO built with nestjs-zod's createZodDto is
  // validated automatically.
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // si:providers
  ],
})
export class AppModule {}
