import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

export type AuthUserProfile = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type JwtPayload = {
  sub: string;
  email: string;
  name: string;
  role: string;
};

const DEFAULT_ADMIN_EMAIL = 'admin@teampulse.com';
const DEFAULT_ADMIN_PASSWORD = 'Admin@123456';
const DEFAULT_ADMIN_NAME = 'Admin';
const DEFAULT_ADMIN_ROLE = 'admin';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDefaultAdmin();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Default admin bootstrap failed: ${message}`);
    }
  }

  async login(email: string, password: string): Promise<{
    accessToken: string;
    user: AuthUserProfile;
  }> {
    const user = await this.validateUser(email, password);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user,
    };
  }

  async validateUser(email: string, password: string): Promise<AuthUserProfile> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const account = await this.prisma.adminUser.findUnique({
      where: { email: normalizedEmail },
    });

    if (!account) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const valid = await bcrypt.compare(password, account.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return this.toProfile(account);
  }

  async getProfile(accountId: string): Promise<AuthUserProfile> {
    const account = await this.prisma.adminUser.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new UnauthorizedException('Session is no longer valid.');
    }

    return this.toProfile(account);
  }

  async syncSlackUser(
    slackUserId: string,
    slackWorkspaceId: string,
    slackWorkspaceName = 'Unknown Workspace',
  ) {
    const workspace = await this.prisma.workspace.upsert({
      where: { slackWorkspaceId },
      update: {},
      create: {
        slackWorkspaceId,
        slackWorkspaceName,
        botToken: process.env.SLACK_BOT_TOKEN || '',
      },
    });

    const user = await this.prisma.user.upsert({
      where: { slackUserId },
      update: {},
      create: {
        slackUserId,
        workspaceId: workspace.id,
        slackDisplayName: slackUserId,
      },
    });

    const existingMembership = await this.prisma.teamMember.findFirst({
      where: { userId: user.id },
    });

    if (!existingMembership) {
      let team = await this.prisma.team.findFirst({
        where: { workspaceId: workspace.id },
        orderBy: { createdAt: 'asc' },
      });

      if (!team) {
        team = await this.prisma.team.create({
          data: {
            workspaceId: workspace.id,
            name: 'General',
            scheduleCron: '0 0 9 * * 0-4',
            timezone: 'Asia/Riyadh',
            schedulerEnabled: true,
          },
        });
      }

      await this.prisma.teamMember.upsert({
        where: {
          teamId_userId: {
            teamId: team.id,
            userId: user.id,
          },
        },
        update: { optedOut: false },
        create: {
          teamId: team.id,
          userId: user.id,
          role: 'member',
          optedOut: false,
        },
      });
    }

    return user;
  }

  private async ensureDefaultAdmin(): Promise<void> {
    const count = await this.prisma.adminUser.count();
    if (count > 0) {
      return;
    }

    const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12);
    await this.prisma.adminUser.create({
      data: {
        email: DEFAULT_ADMIN_EMAIL,
        name: DEFAULT_ADMIN_NAME,
        password: passwordHash,
        role: DEFAULT_ADMIN_ROLE,
      },
    });

    this.logger.log(
      `Created default admin account (${DEFAULT_ADMIN_EMAIL}). Change the password after first login.`,
    );
  }

  private toProfile(account: {
    id: string;
    name: string;
    email: string;
    role: string;
  }): AuthUserProfile {
    return {
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.role,
    };
  }
}
