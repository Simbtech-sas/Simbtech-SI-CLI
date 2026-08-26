import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt'; // si:when auth-builtin
import { JwtAccessGuard } from './interface/jwt-access.guard'; // si:when auth-builtin
import { OidcAccessGuard } from './interface/oidc-access.guard'; // si:when auth-oidc
import { PermissionsGuard } from './interface/permissions.guard';
import { RolesGuard } from './interface/roles.guard';

/**
 * Token VERIFICATION only — no user store, no login endpoints.
 *
 * Two implementations, one exported name (`AccessGuard`), chosen at scaffold
 * time. Feature modules import the name and never learn which provider is behind
 * it, so switching from the built-in identity to Keycloak touches this file and
 * nothing else.
 */
@Global()
@Module({
  imports: [JwtModule.register({ global: true })], // si:when auth-builtin
  providers: [
    JwtAccessGuard, // si:when auth-builtin
    OidcAccessGuard, // si:when auth-oidc
    RolesGuard,
    PermissionsGuard,
  ],
  exports: [
    JwtAccessGuard, // si:when auth-builtin
    OidcAccessGuard, // si:when auth-oidc
    RolesGuard,
    PermissionsGuard,
  ],
})
export class AuthModule {}
