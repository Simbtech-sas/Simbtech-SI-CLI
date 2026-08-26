import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { AccessTokenPayload } from '../../auth/domain/jwt-payload';
import { CurrentPrincipal } from '../../auth/interface/current-principal.decorator';
import { AccessGuard } from '../../auth/interface/access.guard';
import { Idempotent } from '../../security/interface/idempotent.decorator';
import { IdempotencyInterceptor } from '../../security/interface/idempotency.interceptor';
import { WidgetsService } from '../application/widgets.service';
import { CreateWidgetDto, UpdateWidgetDto } from './dto';

/**
 * Example tenant-scoped CRUD resource. The tenant id comes from the verified
 * access token (never the client body), and every service call passes it down to
 * runInTenantContext(), so RLS — not this code — is the isolation boundary.
 */
@Controller('widgets')
@UseGuards(AccessGuard)
export class WidgetsController {
  constructor(private readonly widgets: WidgetsService) {}

  @Get()
  list(@CurrentPrincipal() p: AccessTokenPayload) {
    return this.widgets.list(p.tenantId);
  }

  @Get(':id')
  get(@CurrentPrincipal() p: AccessTokenPayload, @Param('id') id: string) {
    return this.widgets.get(p.tenantId, id);
  }

  // Creation is the classic double-submit: a client that times out mid-request
  // retries and makes two. The key makes the retry return the first result.
  // `required: false` here because a widget is cheap; make it required on
  // anything that moves money.
  @Post()
  @Idempotent({ required: false })
  @UseInterceptors(IdempotencyInterceptor)
  create(@CurrentPrincipal() p: AccessTokenPayload, @Body() dto: CreateWidgetDto) {
    return this.widgets.create(p.tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentPrincipal() p: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateWidgetDto,
  ) {
    return this.widgets.update(p.tenantId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentPrincipal() p: AccessTokenPayload, @Param('id') id: string) {
    return this.widgets.remove(p.tenantId, id);
  }
}
