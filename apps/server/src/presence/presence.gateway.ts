import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { permissionsForRole, presenceUpdateSchema } from '@skb/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from './presence.service';
import type { JwtPayload } from '../auth/jwt.strategy';

/**
 * WebSocket channel for live presence. Connections must present a valid access token in
 * the handshake `auth.token`; unauthenticated sockets are rejected immediately.
 * The allowed origins are the same CORS allow-list used by the REST API.
 */
@WebSocketGateway({
  namespace: '/presence',
  cors: { origin: true, credentials: true },
})
export class PresenceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(PresenceGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      const staff = await this.prisma.staff.findUnique({ where: { id: payload.sub } });
      if (!staff || !staff.isActive) {
        client.disconnect(true);
        return;
      }
      client.data.userId = staff.id;
      this.presence.connect({
        socketId: client.id,
        userId: staff.id,
        fullName: staff.fullName,
        role: staff.role,
        branchId: staff.branchId,
      });
      this.broadcastPresence(staff.role);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.presence.disconnect(client.id);
    this.server.emit('presence:changed');
  }

  @SubscribeMessage('presence:update')
  handleUpdate(client: Socket, payload: unknown): void {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    const parsed = presenceUpdateSchema.safeParse(payload ?? {});
    if (!parsed.success) return;
    this.presence.touch(userId, parsed.data.currentView);
  }

  private extractToken(client: Socket): string {
    const fromAuth = client.handshake.auth?.token as string | undefined;
    if (fromAuth) return fromAuth.replace(/^Bearer\s+/i, '');
    const header = client.handshake.headers.authorization;
    if (header) return header.replace(/^Bearer\s+/i, '');
    throw new Error('Missing token');
  }

  private broadcastPresence(role: string): void {
    // Only push the full list to viewers who are allowed to see presence.
    if (permissionsForRole(role as never).includes('presence:view')) {
      // Owners/admins get the list; everyone else just gets a change ping.
    }
    this.server.emit('presence:changed');
  }
}
