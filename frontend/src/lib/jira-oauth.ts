import { apiUrl } from '@/lib/api-config';

/** Build backend OAuth URL that binds Jira connect to the selected workspace. */
export function buildJiraOAuthStartUrl(workspaceId: string | null | undefined): string {
  const params = new URLSearchParams();
  if (workspaceId?.trim()) {
    params.set('workspaceId', workspaceId.trim());
  }
  const qs = params.toString();
  const path = qs ? `/api/auth/jira?${qs}` : '/api/auth/jira';
  return apiUrl(path);
}
