import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WidgetsService } from './application/widgets.service';
import { WidgetsEventHandlers } from './application/widgets.event-handlers';
import { WidgetsRepository } from './infrastructure/widgets.repository';
import { WidgetsController } from './interface/widgets.controller';

@Module({
  imports: [AuthModule], // token verification only — no user store
  controllers: [WidgetsController],
  providers: [WidgetsService, WidgetsRepository, WidgetsEventHandlers],
  exports: [WidgetsService],
})
export class WidgetsModule {}
