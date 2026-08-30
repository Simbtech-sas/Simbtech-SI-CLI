import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from './application/auth.service';
import { TokenService } from './application/token.service';
import { IamRepository } from './infrastructure/iam.repository';
import { PasswordService } from './infrastructure/password.service';
import { AuthController } from './interface/auth.controller';

/**
 * The identity service: users, tenants, memberships, and the only place access // si:when multi-tenant
 * The identity service: users, and the only place access // si:when single-tenant
 * tokens are ISSUED. Present in the `identity` profile only.
 *
 * Other services import `AuthModule` instead — they verify tokens without a user
 * store, so there is exactly one source of truth for who a user is.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    AuthController,
    // si:controllers
  ],
  providers: [
    AuthService,
    TokenService,
    IamRepository,
    PasswordService,
    // si:iam-providers
  ],
  exports: [IamRepository, TokenService],
})
export class IamModule {}
