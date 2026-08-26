import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  /** Liveness probe. */
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
