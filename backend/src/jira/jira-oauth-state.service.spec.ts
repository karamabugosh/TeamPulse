import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JiraOAuthStateService } from './jira-oauth-state.service';

type OAuthStateRecord = {
  workspaceId: string;
  userId: string;
  stateHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

type MockOptions = {
  userExists?: boolean;
};

const createService = (
  options: MockOptions = {},
) => {
  const userExists = options.userExists ?? true;

  const records = new Map<
    string,
    OAuthStateRecord
  >();

  const deletedStates: string[] = [];

  const jiraOAuthStateDelegate = {
    updateMany: async ({
      where,
      data,
    }: {
      where: {
        stateHash: string;
        consumedAt: null;
        expiresAt: {
          gt: Date;
        };
      };
      data: {
        consumedAt: Date;
      };
    }) => {
      const record = records.get(where.stateHash);

      if (
        !record ||
        record.consumedAt !== null ||
        record.expiresAt <= where.expiresAt.gt
      ) {
        return {
          count: 0,
        };
      }

      record.consumedAt = data.consumedAt;

      return {
        count: 1,
      };
    },

    findUnique: async ({
      where,
    }: {
      where: {
        stateHash: string;
      };
    }) => {
      const record = records.get(where.stateHash);

      if (!record) {
        return null;
      }

      return {
        userId: record.userId,
        workspaceId: record.workspaceId,
      };
    },
  };

  const prisma = {
    user: {
      findUnique: async () =>
        userExists
          ? {
              id: 'pulse-user-1',
              workspaceId: 'workspace-1',
            }
          : null,
    },

    jiraOAuthState: {
      deleteMany: async ({
        where,
      }: {
        where: {
          userId: string;
        };
      }) => {
        let deletedCount = 0;

        for (const [stateHash, record] of records) {
          if (
            record.userId === where.userId &&
            (record.expiresAt <= new Date() ||
              record.consumedAt !== null)
          ) {
            records.delete(stateHash);
            deletedStates.push(stateHash);
            deletedCount += 1;
          }
        }

        return {
          count: deletedCount,
        };
      },

      create: async ({
        data,
      }: {
        data: {
          workspaceId: string;
          userId: string;
          stateHash: string;
          expiresAt: Date;
        };
      }) => {
        const record: OAuthStateRecord = {
          ...data,
          consumedAt: null,
        };

        records.set(data.stateHash, record);

        return {
          id: 'oauth-state-1',
          ...record,
          createdAt: new Date(),
        };
      },
    },

    $transaction: async <T>(
      callback: (
        transaction: {
          jiraOAuthState:
            typeof jiraOAuthStateDelegate;
        },
      ) => Promise<T>,
    ): Promise<T> =>
      callback({
        jiraOAuthState: jiraOAuthStateDelegate,
      }),
  };

  const service = new JiraOAuthStateService(
    prisma as unknown as PrismaService,
  );

  return {
    service,
    records,
    deletedStates,
  };
};

describe('JiraOAuthStateService', () => {
  test('issues a random state and stores only its SHA-256 hash', async () => {
    const { service, records } = createService();

    const beforeIssue = Date.now();

    const issued = await service.issueState(
      ' pulse-user-1 ',
    );

    const afterIssue = Date.now();

    assert.match(
      issued.state,
      /^[A-Za-z0-9_-]{43}$/,
    );

    assert.equal(records.size, 1);

    const [record] = [...records.values()];

    assert.notEqual(record.stateHash, issued.state);

    assert.match(record.stateHash, /^[a-f0-9]{64}$/);

    assert.equal(record.userId, 'pulse-user-1');
    assert.equal(record.workspaceId, 'workspace-1');

    const minimumExpiry =
      beforeIssue + 10 * 60 * 1000;

    const maximumExpiry =
      afterIssue + 10 * 60 * 1000;

    assert.ok(
      issued.expiresAt.getTime() >= minimumExpiry,
    );

    assert.ok(
      issued.expiresAt.getTime() <= maximumExpiry,
    );
  });

  test('issues a different state for every request', async () => {
    const { service } = createService();

    const first = await service.issueState(
      'pulse-user-1',
    );

    const second = await service.issueState(
      'pulse-user-1',
    );

    assert.notEqual(first.state, second.state);
  });

  test('rejects issuing a state for an unknown user', async () => {
    const { service } = createService({
      userExists: false,
    });

    await assert.rejects(
      () => service.issueState('missing-user'),
      (error: unknown) =>
        error instanceof NotFoundException,
    );
  });

  test('rejects issuing a state without a user ID', async () => {
    const { service } = createService();

    await assert.rejects(
      () => service.issueState('   '),
      (error: unknown) =>
        error instanceof BadRequestException,
    );
  });

  test('consumes a valid state once and returns its owner', async () => {
    const { service } = createService();

    const issued = await service.issueState(
      'pulse-user-1',
    );

    const consumed = await service.consumeState(
      issued.state,
    );

    assert.deepEqual(consumed, {
      userId: 'pulse-user-1',
      workspaceId: 'workspace-1',
    });

    await assert.rejects(
      () => service.consumeState(issued.state),
      (error: unknown) =>
        error instanceof UnauthorizedException,
    );
  });

  test('rejects an expired state', async () => {
    const { service, records } = createService();

    const issued = await service.issueState(
      'pulse-user-1',
    );

    const [record] = [...records.values()];

    record.expiresAt = new Date(Date.now() - 1000);

    await assert.rejects(
      () => service.consumeState(issued.state),
      (error: unknown) =>
        error instanceof UnauthorizedException,
    );
  });

  test('rejects an unknown state', async () => {
    const { service } = createService();

    await assert.rejects(
      () =>
        service.consumeState(
          'unknown-oauth-state-value',
        ),
      (error: unknown) =>
        error instanceof UnauthorizedException,
    );
  });

  test('rejects an empty or excessively long state', async () => {
    const { service } = createService();

    await assert.rejects(
      () => service.consumeState(''),
      (error: unknown) =>
        error instanceof BadRequestException,
    );

    await assert.rejects(
      () => service.consumeState('a'.repeat(513)),
      (error: unknown) =>
        error instanceof BadRequestException,
    );
  });

  test('removes expired states before issuing a new one', async () => {
    const {
      service,
      records,
      deletedStates,
    } = createService();

    const first = await service.issueState(
      'pulse-user-1',
    );

    const [firstRecord] = [...records.values()];

    firstRecord.expiresAt = new Date(
      Date.now() - 1000,
    );

    await service.issueState('pulse-user-1');

    assert.equal(records.size, 1);
    assert.equal(deletedStates.length, 1);

    assert.notEqual(
      [...records.values()][0].stateHash,
      first.state,
    );
  });
});