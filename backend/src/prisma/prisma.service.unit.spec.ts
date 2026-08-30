import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(() => {
    service = new PrismaService();
    service.$connect = jest.fn(async () => undefined) as never;
    service.$disconnect = jest.fn(async () => undefined) as never;
  });

  describe('onModuleInit', () => {
    it('connects to the database on module init', async () => {
      await service.onModuleInit();

      expect(service.$connect).toHaveBeenCalledTimes(1);
    });

    it('propagates connect failures', async () => {
      service.$connect = jest.fn(async () => {
        throw new Error('connect failed');
      }) as never;

      await expect(service.onModuleInit()).rejects.toThrow('connect failed');
    });
  });

  describe('onModuleDestroy', () => {
    it('disconnects from the database on module destroy', async () => {
      await service.onModuleDestroy();

      expect(service.$disconnect).toHaveBeenCalledTimes(1);
    });

    it('propagates disconnect failures', async () => {
      service.$disconnect = jest.fn(async () => {
        throw new Error('disconnect failed');
      }) as never;

      await expect(service.onModuleDestroy()).rejects.toThrow(
        'disconnect failed',
      );
    });
  });
});
