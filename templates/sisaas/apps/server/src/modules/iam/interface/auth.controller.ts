import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LoginThrottleGuard } from '../../security/interface/login-throttle.guard';
import { AppConfigService } from '../../../config/app-config.service';
import { AuthService, type AuthResult } from '../application/auth.service';
import type { AccessTokenPayload, AuthSessionMeta } from '../../auth/domain/jwt-payload';
import { ChangePasswordDto, LoginDto, RegisterDto, UpdateProfileDto } from './dto';
import { CurrentPrincipal } from '../../auth/interface/current-principal.decorator';
import { AccessGuard } from '../../auth/interface/access.guard';

// @fastify/cookie exposes these at runtime (registered in main.ts); its `exports`
// map defeats type augmentation, so cast at the call sites.
type WithCookies = { cookies: Record<string, string | undefined> };
type WithSetCookie = {
  setCookie(name: string, value: string, opts?: Record<string, unknown>): void;
  clearCookie(name: string, opts?: Record<string, unknown>): void;
};

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_PATH = '/auth';

/**
 * How a native client says it cannot use cookies.
 *
 * A browser must NOT get the refresh token in the response body: httpOnly is
 * the only thing keeping it away from XSS. A native app is the opposite case —
 * it has no cookie jar, it has Keychain/Keystore, and a `Set-Cookie` it cannot
 * read means the session dies when the access token expires.
 *
 * So the client declares itself, explicitly. Not user-agent sniffing: that is a
 * guess about a security decision, and the guess is wrong on every embedded
 * webview.
 */
const NATIVE_CLIENT_HEADER = 'x-client-type';

function isNativeClient(req: FastifyRequest): boolean {
  return String(req.headers[NATIVE_CLIENT_HEADER] ?? '').toLowerCase() === 'native';
}

@Controller('auth')
// Credential endpoints only. The global 300/min limiter is sized for ordinary
// API traffic and would happily allow 300 password guesses a minute.
@UseGuards(LoginThrottleGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.respond(req, reply, await this.auth.register(dto, this.meta(req)));
  }

  // si:when-begin multi-tenant
  /** Is this email / workspace slug free? Used by the signup form. */
  @Get('available')
  available(@Query('email') email?: string, @Query('slug') slug?: string) {
    return this.auth.checkAvailability({
      email: email?.trim().toLowerCase() || undefined,
      slug: slug?.trim().toLowerCase() || undefined,
    });
  }
  // si:when-end

  // si:when-begin single-tenant
  /** Is this email free? Used by the signup form. */
  @Get('available')
  available(@Query('email') email?: string) {
    return this.auth.checkAvailability({ email: email?.trim().toLowerCase() || undefined });
  }
  // si:when-end

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.respond(req, reply, await this.auth.login(dto, this.meta(req)));
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body?: { refreshToken?: string },
  ) {
    // Cookie for browsers, body for native clients. Reading only the cookie is
    // what made every mobile app log its user out the moment the access token
    // expired: the app held the token and had nowhere to put it.
    const token = (req as unknown as WithCookies).cookies[REFRESH_COOKIE] ?? body?.refreshToken;
    if (!token) throw new UnauthorizedException('No session');
    const rotated = await this.auth.refresh(token, this.meta(req));
    this.setRefreshCookie(reply, rotated.refreshToken, rotated.refreshExpiresAt);
    return {
      accessToken: rotated.accessToken,
      // Rotation means the old token is now dead. A native client that does not
      // receive the new one is logged out at the next refresh.
      ...(isNativeClient(req) ? { refreshToken: rotated.refreshToken } : {}),
    };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = (req as unknown as WithCookies).cookies[REFRESH_COOKIE];
    if (token) await this.auth.logout(token);
    (reply as unknown as WithSetCookie).clearCookie(REFRESH_COOKIE, {
      path: REFRESH_PATH,
    });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AccessGuard)
  me(@CurrentPrincipal() p: AccessTokenPayload) {
    return p;
  }

  @Get('profile')
  @UseGuards(AccessGuard)
  profile(@CurrentPrincipal() p: AccessTokenPayload) {
    return this.auth.getProfile(p.sub);
  }

  @Patch('profile')
  @UseGuards(AccessGuard)
  async updateProfile(
    @CurrentPrincipal() p: AccessTokenPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    await this.auth.updateProfile(p.sub, dto);
    return { ok: true };
  }

  @Post('password')
  @UseGuards(AccessGuard)
  changePassword(
    @CurrentPrincipal() p: AccessTokenPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(p.sub, dto.currentPassword, dto.newPassword);
  }

  private respond(req: FastifyRequest, reply: FastifyReply, result: AuthResult) {
    // The cookie is always set. It is ignored by a native client and it is the
    // only safe carrier for a browser, so there is no case for skipping it.
    this.setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt);
    return {
      accessToken: result.accessToken,
      // Body copy for native clients ONLY. In a browser this field is readable
      // by any script on the page, which is precisely what httpOnly prevents.
      ...(isNativeClient(req) ? { refreshToken: result.refreshToken } : {}),
      user: result.user,
      tenant: result.tenant, // si:when multi-tenant
      role: result.role,
    };
  }

  private setRefreshCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
    (reply as unknown as WithSetCookie).setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      path: REFRESH_PATH,
      expires: expiresAt,
    });
  }

  private meta(req: FastifyRequest): AuthSessionMeta {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }
}
