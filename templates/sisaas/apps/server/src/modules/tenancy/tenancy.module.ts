import { Module } from '@nestjs/common';
import { TenantProjection } from './application/tenant-projection';

/**
 * The local tenant read model. Present in every profile EXCEPT identity, which
 * owns the tenants table directly and would otherwise project its own events
 * back onto itself.
 */
@Module({
  providers: [TenantProjection],
})
export class TenancyModule {}
