import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AccessTokenPayload } from '../../auth/domain/jwt-payload';
import { CurrentPrincipal } from '../../auth/interface/current-principal.decorator';
import { AccessGuard } from '../../auth/interface/access.guard';
import { Roles, RolesGuard } from '../../auth/interface/roles.guard';
import { AuditService } from '../application/audit.service';

/**
 * Reading the audit log.
 *
 * Owner and admin only. The log records who did what, which makes it exactly
 * the thing a compromised member account would want to read — and, if it were
 * writable from here, to edit. There is no write route: entries arrive through
 * `AuditService` from the code doing the work, and a database trigger rejects
 * UPDATE and DELETE outright.
 */
@Controller('audit')
@UseGuards(AccessGuard, RolesGuard)
@Roles('owner', 'admin')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @CurrentPrincipal() p: AccessTokenPayload,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const take = Number(limit) || 50;
    // `before` is a cursor on `seq`, not an offset: an append-only table gets
    // new rows at the head, and OFFSET would re-show a row on the next page.
    const cursor = before ? Number(before) : undefined;
    return this.audit.recent(p.tenantId, take, cursor); // si:when multi-tenant
    return this.audit.recent(take, cursor); // si:when single-tenant
  }

  /**
   * Recompute every hash and report the first entry that does not match.
   *
   * This is the whole point of the chain, and it is worth exposing: a log
   * nobody ever verifies is a log nobody can rely on.
   */
  @Get('verify')
  verify(@CurrentPrincipal() p: AccessTokenPayload) {
    return this.audit.verifyTenantChain(p.tenantId); // si:when multi-tenant
    return this.audit.verifyChain(); // si:when single-tenant
  }
}
