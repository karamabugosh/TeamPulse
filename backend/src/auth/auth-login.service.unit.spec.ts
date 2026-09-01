import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService login', () => {
  let service: AuthService;
  let prisma: {
    adminUser: {
      count: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      adminUser: {
        count: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('jwt-token') } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-secret') },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('login returns JWT for valid credentials', async () => {
    const hash = await bcrypt.hash('Admin@123456', 4);
    prisma.adminUser.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@teampulse.com',
      name: 'Admin',
      role: 'admin',
      password: hash,
    });

    const result = await service.login('admin@teampulse.com', 'Admin@123456');

    expect(result.accessToken).toBe('jwt-token');
    expect(result.user).toEqual({
      id: 'admin-1',
      email: 'admin@teampulse.com',
      name: 'Admin',
      role: 'admin',
    });
  });

  it('login rejects invalid password', async () => {
    const hash = await bcrypt.hash('Admin@123456', 4);
    prisma.adminUser.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@teampulse.com',
      name: 'Admin',
      role: 'admin',
      password: hash,
    });

    await expect(
      service.login('admin@teampulse.com', 'wrong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
