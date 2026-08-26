import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AppConfigService } from '../../config/app-config.service';
import type { AccessTokenPayload } from '../auth/domain/jwt-payload';
import { JWT_ALGORITHM, JWT_ISSUER } from '../auth/domain/jwt.constants';

interface Handshake {
  token?: string;
}

interface SocketData {
  tenantId: string;
  role?: string;
}

/**
 * Realtime fan-out over Socket.IO. Authorization happens at connect: a valid
 * access token joins the socket to its tenant's room, so tenants never receive
 * each other's events. Add `@SubscribeMessage` handlers and `emitToTenant` calls
 * for the events your app needs.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() private readonly server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    const auth = (socket.handshake.auth ?? {}) as Handshake;
    try {
      if (!auth.token) throw new Error('missing credentials');
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(auth.token, {
        secret: this.config.jwtAccessSecret,
        // Pinned exactly as the HTTP guard pins it. A websocket handshake is a
        // second front door, and one unpinned verifier undoes every other.
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
      });
      socket.data = {
        tenantId: payload.tenantId,
        role: payload.role,
      } satisfies SocketData;
      await socket.join(this.tenantRoom(payload.tenantId));
      socket.emit('ready');
    } catch {
      socket.emit('unauthorized');
      socket.disconnect(true);
    }
  }

  /** Broadcast an event to every socket currently in a tenant's room. */
  emitToTenant(tenantId: string, event: string, payload: unknown): void {
    this.server.to(this.tenantRoom(tenantId)).emit(event, payload);
  }

  private tenantRoom(tenantId: string): string {
    return `tenant:${tenantId}`;
  }
}
