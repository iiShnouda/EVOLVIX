import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { permissionsForRole, type AuthUser, type LoginInput } from '@skb/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TokenService, type SessionContext } from './token.service';

export interface LoginResult {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /** argon2id — memory-hard password hashing. Used by the seed and any user creation. */
  static hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async login(input: LoginInput, ctx: SessionContext): Promise<LoginResult> {
    const staff = await this.prisma.staff.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    // Constant-ish work whether or not the user exists, then a generic error either way,
    // so we don't leak which emails are registered.
    const ok = staff ? await argon2.verify(staff.passwordHash, input.password) : false;
    if (!staff || !ok || !staff.isActive) {
      await this.audit.recordAnonymous(
        input.email,
        { action: 'auth.login.failed', resource: 'auth' },
        ctx,
      );
      throw new UnauthorizedException({
        message: 'Incorrect email or password',
        code: 'INVALID_CREDENTIALS',
      });
    }

    const accessToken = await this.tokens.issueAccessToken(staff);
    const refreshToken = await this.tokens.createSession(staff.id, ctx);
    const user: AuthUser = {
      id: staff.id,
      fullName: staff.fullName,
      email: staff.email,
      role: staff.role,
      branchId: staff.branchId,
      permissions: permissionsForRole(staff.role),
    };
    await this.audit.record(user, { action: 'auth.login', resource: 'auth' }, ctx);
    return { user, accessToken, refreshToken };
  }

  async refresh(
    rawToken: string,
    ctx: SessionContext,
  ): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
    const { staff, refreshToken } = await this.tokens.rotateSession(rawToken, ctx);
    const accessToken = await this.tokens.issueAccessToken(staff);
    const user: AuthUser = {
      id: staff.id,
      fullName: staff.fullName,
      email: staff.email,
      role: staff.role,
      branchId: staff.branchId,
      permissions: permissionsForRole(staff.role),
    };
    return { user, accessToken, refreshToken };
  }

  async logout(rawToken: string | undefined, actor: AuthUser | null, ctx: SessionContext) {
    if (rawToken) await this.tokens.revokeByRawToken(rawToken);
    if (actor) await this.audit.record(actor, { action: 'auth.logout', resource: 'auth' }, ctx);
  }
}
