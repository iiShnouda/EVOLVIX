import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Staff } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptFromBuffer, encryptToBuffer, generateOpaqueToken, sha256 } from '../common/crypto';

export interface SessionContext {
  ip?: string;
  userAgent?: string;
  deviceLabel?: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Short-lived signed access token (JWT). Carries no secrets beyond identity. */
  async issueAccessToken(staff: Pick<Staff, 'id' | 'email'>): Promise<string> {
    return this.jwt.signAsync(
      { sub: staff.id, email: staff.email },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        // Coerce to a number so jsonwebtoken treats it as SECONDS, not a string parsed
        // as milliseconds by the `ms` library (which would expire the token instantly).
        expiresIn: Number(this.config.getOrThrow('JWT_ACCESS_TTL')),
      },
    );
  }

  /**
   * Create a new refresh session. The raw refresh token is returned to the caller (to be
   * set as an httpOnly cookie) but is never stored in plaintext: we persist its SHA-256
   * hash for lookup and an AES-256-GCM ciphertext of it for at-rest confidentiality.
   */
  async createSession(staffId: string, ctx: SessionContext): Promise<string> {
    const rawToken = generateOpaqueToken();
    const ttl = Number(this.config.getOrThrow('JWT_REFRESH_TTL'));
    const key = this.config.getOrThrow<string>('SESSION_ENCRYPTION_KEY');
    await this.prisma.session.create({
      data: {
        staffId,
        tokenHash: sha256(rawToken),
        encryptedToken: encryptToBuffer(rawToken, key),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        deviceLabel: ctx.deviceLabel,
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });
    return rawToken;
  }

  /**
   * Validate a refresh token and rotate it (revoke the old, issue a new one). Rotation
   * limits the damage of a leaked refresh token and keeps sessions revocable.
   */
  async rotateSession(
    rawToken: string,
    ctx: SessionContext,
  ): Promise<{ staff: Staff; refreshToken: string }> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { staff: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired session');
    }
    if (!session.staff.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }
    // Confirm the stored ciphertext decrypts to the presented token (integrity check).
    const key = this.config.getOrThrow<string>('SESSION_ENCRYPTION_KEY');
    if (decryptFromBuffer(session.encryptedToken, key) !== rawToken) {
      throw new UnauthorizedException('Session integrity check failed');
    }

    const newToken = generateOpaqueToken();
    const ttl = Number(this.config.getOrThrow('JWT_REFRESH_TTL'));
    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.session.create({
        data: {
          staffId: session.staffId,
          tokenHash: sha256(newToken),
          encryptedToken: encryptToBuffer(newToken, key),
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          deviceLabel: ctx.deviceLabel,
          expiresAt: new Date(Date.now() + ttl * 1000),
        },
      }),
    ]);
    return { staff: session.staff, refreshToken: newToken };
  }

  async revokeByRawToken(rawToken: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoke a specific session by id (used by the owner's session-management view). */
  async revokeById(sessionId: string, staffId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, staffId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
