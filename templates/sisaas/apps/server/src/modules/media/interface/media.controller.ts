import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { AccessTokenPayload } from '../../auth/domain/jwt-payload';
import { CurrentPrincipal } from '../../auth/interface/current-principal.decorator';
import { AccessGuard } from '../../auth/interface/access.guard';
import { MediaService } from '../application/media.service';
import { CreateUploadDto } from './dto';

@Controller('media')
@UseGuards(AccessGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** Get a presigned URL to upload an object directly to storage. */
  @Post('uploads')
  createUpload(
    @CurrentPrincipal() p: AccessTokenPayload,
    @Body() dto: CreateUploadDto,
  ) {
    return this.media.createUpload(p.tenantId, dto);
  }
}
