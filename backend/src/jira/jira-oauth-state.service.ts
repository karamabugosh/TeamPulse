import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  randomBytes,
} from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const OAUTH_STATE_TTL_MINUTES = 10;
const OAUTH_STATE_RANDOM_BYTES = 32;
const MAX_STATE_LENGTH = 512;

export type IssuedJiraOAuthState = {
  state: string;
  expiresAt: Date;
};

export type ConsumedJiraOAuthState = {
  userId: string;
  workspaceId: string;
};

@Injectable()
export class JiraOAuthStateService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async issueState(
    userIdInput: string,
  ): Promise<IssuedJiraOAuthState> {
    const userId = userIdInput?.trim();

    if (!userId) {
      throw new BadRequestException(
        'userId is required to start Jira authorization.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        workspaceId: true,
      },
    });

    if (!user) {
      throw new NotFoundException(
        `User ${userId} was not found.`,
      );
    }

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() +
        OAUTH_STATE_TTL_MINUTES * 60 * 1000,
    );

    await this.prisma.jiraOAuthState.deleteMany({
      where: {
        userId: user.id,
        OR: [
          {
            expiresAt: {
              lte: now,
            },
          },
          {
            consumedAt: {
              not: null,
            },
          },
        ],
      },
    });

    const state = randomBytes(
      OAUTH_STATE_RANDOM_BYTES,
    ).toString('base64url');

    const stateHash = this.hashState(state);

    await this.prisma.jiraOAuthState.create({
      data: {
        workspaceId: user.workspaceId,
        userId: user.id,
        stateHash,
        expiresAt,
      },
    });

    return {
      state,
      expiresAt,
    };
  }

  async consumeState(
    stateInput: string,
  ): Promise<ConsumedJiraOAuthState> {
    const state = stateInput?.trim();

    if (!state || state.length > MAX_STATE_LENGTH) {
      throw new BadRequestException(
        'A valid Jira OAuth state is required.',
      );
    }

    const stateHash = this.hashState(state);
    const consumedAt = new Date();

    return this.prisma.$transaction(
      async (transaction) => {
        const consumeResult =
          await transaction.jiraOAuthState.updateMany({
            where: {
              stateHash,
              consumedAt: null,
              expiresAt: {
                gt: consumedAt,
              },
            },
            data: {
              consumedAt,
            },
          });

        if (consumeResult.count !== 1) {
          throw new UnauthorizedException(
            'The Jira authorization request is invalid, expired, or already used.',
          );
        }

        const consumedState =
          await transaction.jiraOAuthState.findUnique({
            where: {
              stateHash,
            },
            select: {
              userId: true,
              workspaceId: true,
            },
          });

        if (!consumedState) {
          throw new UnauthorizedException(
            'The Jira authorization request could not be verified.',
          );
        }

        return consumedState;
      },
    );
  }

  private hashState(state: string): string {
    return createHash('sha256')
      .update(state, 'utf8')
      .digest('hex');
  }
}