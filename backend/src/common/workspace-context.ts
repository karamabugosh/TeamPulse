import { AsyncLocalStorage } from 'async_hooks';
import type { PrismaClient } from '@prisma/client';

type WorkspaceStore = {
  workspaceId: string | null;
};

export const workspaceStorage = new AsyncLocalStorage<WorkspaceStore>();

export function getRequestWorkspaceId(): string | null {
  return workspaceStorage.getStore()?.workspaceId ?? null;
}

export function runWithWorkspaceId<T>(
  workspaceId: string | null,
  fn: () => T,
): T {
  return workspaceStorage.run({ workspaceId }, fn);
}

/**
 * Prefer X-Workspace-Id from the request, else an explicit preferred id,
 * else the earliest installed workspace (dev/prod default).
 */
export async function resolveActiveWorkspaceId(
  prisma: PrismaClient,
  preferred?: string | null,
): Promise<string | null> {
  const fromRequest = getRequestWorkspaceId();
  const candidate = fromRequest || preferred?.trim() || null;

  if (candidate) {
    const found = await prisma.workspace.findUnique({
      where: { id: candidate },
      select: { id: true },
    });
    if (found) return found.id;
  }

  const first = await prisma.workspace.findFirst({
    orderBy: { installedAt: 'asc' },
    select: { id: true },
  });
  return first?.id ?? null;
}

export function workspaceTeamFilter(workspaceId: string) {
  return { workspaceId };
}

export function workspaceUserFilter(workspaceId: string) {
  return { workspaceId };
}

export function workspaceCheckInFilter(workspaceId: string) {
  return { team: { workspaceId } };
}

export function workspaceRunFilter(workspaceId: string) {
  return { team: { workspaceId } };
}

export function workspaceSubmissionFilter(workspaceId: string) {
  return { run: { team: { workspaceId } } };
}

export function workspaceDigestFilter(workspaceId: string) {
  return { team: { workspaceId } };
}

export function workspaceBlockerFilter(workspaceId: string) {
  return { workspaceId };
}

export function workspaceJiraCacheFilter(workspaceId: string) {
  return { workspaceId };
}

export function workspaceJiraAuditFilter(workspaceId: string) {
  return { workspaceId };
}

export function workspaceAnswerJiraLinkFilter(workspaceId: string) {
  return { workspaceId };
}
