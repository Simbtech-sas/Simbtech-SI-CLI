import { Global, Module } from '@nestjs/common';
import { AuditService } from './application/audit.service';
import { AuditController } from './interface/audit.controller';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
