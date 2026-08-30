import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryAclContext } from './memory-retrieval.types';

/**
 * Resolves trusted ACL context from Pulse membership tables.
 * Never trusts client-supplied teamIds.
 */
@Injectable()
export class MemoryAclService {
  private readonly logger = new Logger(MemoryAclService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveContext(params: {
    workspaceId: string;
    userId: string;
  }): Promise<MemoryAclContext> {
    const workspaceId = params.workspaceId?.trim();
    const userId = params.userId?.trim();
    if (!workspaceId || !userId) {
      return {
        workspaceId: workspaceId || '',
        userId: userId || '',
        authorizedTeamIds: [],
        userInWorkspace: false,
      };
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, workspaceId },
      select: { id: true },
    });
    if (!user) {
      this.logger.warn(
        `[MemoryAcl] user=${userId} not in workspace=${workspaceId}`,
      );
      return {
        workspaceId,
        userId,
        authorizedTeamIds: [],
        userInWorkspace: false,
      };
    }

    const memberships = await this.prisma.teamMember.findMany({
      where: {
        userId,
        optedOut: false,
        team: { workspaceId },
      },
      select: { teamId: true },
    });

    return {
      workspaceId,
      userId,
      authorizedTeamIds: [...new Set(memberships.map((m) => m.teamId))],
      userInWorkspace: true,
    };
  }

  /**
   * SQL fragment + params for ACL on MemoryChunk.
   * Fail-closed: TEAM requires non-null teamId in authorized set;
   * PRIVATE requires non-null ownerUserId matching user.
   *
   * Param placeholders start at $startIndex.
   */
  buildAclSql(params: {
    acl: MemoryAclContext;
    startIndex: number;
  }): { sql: string; values: unknown[] } {
    const { acl, startIndex } = params;
    // $startIndex = workspaceId already bound by caller typically;
    // We return relative clauses expecting:
    //   workspaceId = $w
    //   AND ( ... )
    const values: unknown[] = [];
    let i = startIndex;

    const userParam = i;
    values.push(acl.userId);
    i += 1;

    if (acl.authorizedTeamIds.length === 0) {
      return {
        sql: `(
          ("visibility" = 'WORKSPACE')
          OR ("visibility" = 'PRIVATE' AND "ownerUserId" IS NOT NULL AND "ownerUserId" = $${userParam})
        )`,
        values,
      };
    }

    const teamParam = i;
    values.push(acl.authorizedTeamIds);
    return {
      sql: `(
        ("visibility" = 'WORKSPACE')
        OR (
          "visibility" = 'TEAM'
          AND "teamId" IS NOT NULL
          AND "teamId" = ANY($${teamParam}::text[])
        )
        OR (
          "visibility" = 'PRIVATE'
          AND "ownerUserId" IS NOT NULL
          AND "ownerUserId" = $${userParam}
        )
      )`,
      values,
    };
  }

  /** In-memory ACL check for rows already loaded (defense in depth). */
  isChunkAuthorized(
    chunk: {
      workspaceId?: string;
      visibility: string;
      teamId: string | null;
      ownerUserId: string | null;
    },
    acl: MemoryAclContext,
  ): boolean {
    if (!acl.userInWorkspace) return false;
    if (chunk.workspaceId && chunk.workspaceId !== acl.workspaceId) return false;

    if (chunk.visibility === 'WORKSPACE') return true;

    if (chunk.visibility === 'TEAM') {
      if (!chunk.teamId) return false;
      return acl.authorizedTeamIds.includes(chunk.teamId);
    }

    if (chunk.visibility === 'PRIVATE') {
      if (!chunk.ownerUserId) return false;
      return chunk.ownerUserId === acl.userId;
    }

    // Unknown visibility → fail closed
    return false;
  }
}
