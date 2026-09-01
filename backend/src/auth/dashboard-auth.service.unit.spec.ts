import { Test, TestingModule } from '@nestjs/testing';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardAuthService } from './dashboard-auth.service';

describe('DashboardAuthService', () => {
  let service: DashboardAuthService;
  let prisma: {
    dashboardAccount: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      dashboardAccount: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardAuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'JWT_SECRET') return 'test-secret-key';
              if (key === 'JWT_EXPIRES_IN') return '1h';
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = module.get(DashboardAuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('login returns token for valid credentials', async () => {
    const hash = await bcrypt.hash('correct-password', 4);
    prisma.dashboardAccount.findUnique.mockResolvedValue({
      id: 'acc-1',
      email: 'admin@example.com',
      name: 'Admin',
      passwordHash: hash,
    });

    const result = await service.login('admin@example.com', 'correct-password');

    expect(result.user).toEqual({
      id: 'acc-1',
      email: 'admin@example.com',
      name: 'Admin',
    });
    expect(result.accessToken).toEqual(expect.any(String));
  });

  it('login rejects invalid password', async () => {
    const hash = await bcrypt.hash('correct-password', 4);
    prisma.dashboardAccount.findUnique.mockResolvedValue({
      id: 'acc-1',
      email: 'admin@example.com',
      name: 'Admin',
      passwordHash: hash,
    });

    await expect(
      service.login('admin@example.com', 'wrong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('verifyToken validates signed JWT', async () => {
    const hash = await bcrypt.hash('pw', 4);
    prisma.dashboardAccount.findUnique.mockResolvedValue({
      id: 'acc-1',
      email: 'admin@example.com',
      name: 'Admin',
      passwordHash: hash,
    });

    const { accessToken } = await service.login('admin@example.com', 'pw');
    const payload = service.verifyToken(accessToken);

    expect(payload.sub).toBe('acc-1');
    expect(payload.email).toBe('admin@example.com');
  });
});
