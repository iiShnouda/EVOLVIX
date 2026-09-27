import { Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '@skb/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditContext {
  ip?: string;
  userAgent?: string;
}

export interface AuditInput {
  action: string;
  resource: string;
  resourceId?: string;
  meta?: Record<string, unknown>;
}

/**
 * Records an immutable trail of meaningful actions. Failures to write an audit entry are
 * logged but never block the user's operation.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    actor: Pick<AuthUser, 'id' | 'fullName' | 'branchId'>,
    input: AuditInput,
    ctx: AuditContext = {},
  ): Promise<void> {
    try {
      await this.prisma.auditEntry.create({
        data: {
          actorId: actor.id,
          actorName: actor.fullName,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          branchId: actor.branchId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          meta: input.meta as object | undefined,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit entry for ${input.action}`, err as Error);
    }
  }

  /** Record an action attributed to an identity string (e.g. failed login by email). */
  async recordAnonymous(
    actorName: string,
    input: AuditInput,
    ctx: AuditContext = {},
  ): Promise<void> {
    try {
      await this.prisma.auditEntry.create({
        data: {
          actorId: 'anonymous',
          actorName,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          meta: input.meta as object | undefined,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write anonymous audit entry for ${input.action}`, err as Error);
    }
  }
}
