import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/** WebSocket fan-out (Socket.IO). JwtService + AppConfigService are global. */
@Module({
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
