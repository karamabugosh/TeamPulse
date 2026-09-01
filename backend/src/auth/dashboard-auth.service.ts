import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';

export type DashboardAuthUser = {
  id: string;
  email: string;
  name: string;
};

export type JwtPayload = {
  sub: string;
  email: string;
  name: string;
};

@Injectable()
export class DashboardAuthService implements OnModuleInit {
  private readonly logger = new Logger(DashboardAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBootstrapAccount();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Dashboard account bootstrap failed: ${message}`);
    }
  }

  async login(email: string, password: string): Promise<{
    accessToken: string;
    user: DashboardAuthUser;
  }> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const account = await this.prisma.dashboardAccount.findUnique({
      where: { email: normalizedEmail },
    });

    if (!account) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const valid = await bcrypt.compare(password, account.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const user: DashboardAuthUser = {
      id: account.id,
      email: account.email,
      name: account.name,
    };

    return {
      accessToken: this.signToken(user),
      user,
    };
  }

  async getProfile(accountId: string): Promise<DashboardAuthUser> {
    const account = await this.prisma.dashboardAccount.findUnique({
      where: { id: accountId },
      select: { id: true, email: true, name: true },
    });

    if (!account) {
      throw new UnauthorizedException('Session is no longer valid.');
    }

    return account;
  }

  verifyToken(token: string): JwtPayload {
    const secret = this.getJwtSecret();
    try {
      const payload = jwt.verify(token, secret) as JwtPayload;
      if (!payload?.sub || !payload.email) {
        throw new UnauthorizedException('Invalid session token.');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired session token.');
    }
  }

  private signToken(user: DashboardAuthUser): string {
    const secret = this.getJwtSecret();
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN')?.trim() || '7d';

    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
      },
      secret,
      { expiresIn },
    );
  }

  private getJwtSecret(): string {
    const secret = this.configService.get<string>('JWT_SECRET')?.trim();
    if (!secret) {
      throw new Error('JWT_SECRET is not configured.');
    }
    return secret;
  }

  private async ensureBootstrapAccount(): Promise<void> {
    const email = this.configService.get<string>('DASHBOARD_ADMIN_EMAIL')?.trim().toLowerCase();
    const password = this.configService.get<string>('DASHBOARD_ADMIN_PASSWORD')?.trim();
    const name =
      this.configService.get<string>('DASHBOARD_ADMIN_NAME')?.trim() || 'Admin';

    if (!email || !password) {
      this.logger.warn(
        'DASHBOARD_ADMIN_EMAIL / DASHBOARD_ADMIN_PASSWORD not set — skipping dashboard account bootstrap.',
      );
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.dashboardAccount.upsert({
      where: { email },
      update: {
        name,
        passwordHash,
      },
      create: {
        email,
        name,
        passwordHash,
      },
    });

    this.logger.log(`Dashboard account ready for ${email}.`);
  }
}
