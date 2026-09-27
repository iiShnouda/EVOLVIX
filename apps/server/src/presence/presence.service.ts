import { Injectable } from '@nestjs/common';
import type { PresenceEntry, Role } from '@skb/shared';

interface TrackedConnection extends PresenceEntry {
  socketIds: Set<string>;
}

/**
 * In-memory registry of who is currently connected. This is intentionally ephemeral:
 * presence is "right now" state, while the durable history lives in the audit log.
 * Backs the future owner/CEO "who is online and what are they doing" view.
 */
@Injectable()
export class PresenceService {
  private readonly byUser = new Map<string, TrackedConnection>();

  connect(params: {
    socketId: string;
    userId: string;
    fullName: string;
    role: Role;
    branchId: string;
  }): void {
    const existing = this.byUser.get(params.userId);
    const now = new Date().toISOString();
    if (existing) {
      existing.socketIds.add(params.socketId);
      existing.lastSeenAt = now;
      return;
    }
    this.byUser.set(params.userId, {
      userId: params.userId,
      fullName: params.fullName,
      role: params.role,
      branchId: params.branchId,
      connectedAt: now,
      lastSeenAt: now,
      socketIds: new Set([params.socketId]),
    });
  }

  disconnect(socketId: string): void {
    for (const [userId, conn] of this.byUser.entries()) {
      if (conn.socketIds.delete(socketId) && conn.socketIds.size === 0) {
        this.byUser.delete(userId);
      }
    }
  }

  touch(userId: string, currentView?: string): void {
    const conn = this.byUser.get(userId);
    if (!conn) return;
    conn.lastSeenAt = new Date().toISOString();
    if (currentView !== undefined) conn.currentView = currentView;
  }

  list(): PresenceEntry[] {
    return Array.from(this.byUser.values()).map(({ socketIds: _socketIds, ...entry }) => entry);
  }
}
