import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './application/encryption.service';
import { IdempotencyService } from './application/idempotency.service';
import { IdempotencyInterceptor } from './interface/idempotency.interceptor';
import { LoginThrottleGuard } from './interface/login-throttle.guard';

/**
 * Cross-cutting security primitives: encryption at rest, credential throttling,
 * and request idempotency.
 *
 * Global because the alternative is every feature module importing it, and the
 * one that forgets is the one that leaks — or charges twice.
 */
@Global()
@Module({
  providers: [EncryptionService, IdempotencyService, IdempotencyInterceptor, LoginThrottleGuard],
  exports: [EncryptionService, IdempotencyService, IdempotencyInterceptor, LoginThrottleGuard],
})
export class SecurityModule {}
