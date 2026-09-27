import { Body, Controller, Get, Post, Req, Res, UsePipes } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { loginSchema, type AuthUser, type LoginInput } from '@skb/shared';
import { Public, CurrentUser } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import type { SessionContext } from './token.service';

const REFRESH_COOKIE = 'skb_rt';
const REFRESH_COOKIE_PATH = '/api/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(body, this.contextFrom(req));
    this.setRefreshCookie(res, result.refreshToken, body.rememberDevice);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) {
      res.status(401);
      return { message: 'No session', code: 'NO_SESSION' };
    }
    const result = await this.auth.refresh(raw, this.contextFrom(req));
    this.setRefreshCookie(res, result.refreshToken, true);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Post('logout')
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.auth.logout(raw, user, this.contextFrom(req));
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  private contextFrom(req: Request): SessionContext {
    return {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    };
  }

  private setRefreshCookie(res: Response, token: string, remember: boolean): void {
    const secure = this.config.get<boolean>('COOKIE_SECURE') ?? false;
    const domain = this.config.get<string>('COOKIE_DOMAIN') || undefined;
    const ttlSeconds = this.config.getOrThrow<number>('JWT_REFRESH_TTL');
    const options: CookieOptions = {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      domain,
      path: REFRESH_COOKIE_PATH,
      // A non-"remember" login is a session cookie (cleared when the browser closes).
      ...(remember ? { maxAge: ttlSeconds * 1000 } : {}),
    };
    res.cookie(REFRESH_COOKIE, token, options);
  }
}
