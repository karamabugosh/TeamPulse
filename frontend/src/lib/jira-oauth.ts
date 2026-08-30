/** Build /api/auth/jira URL that binds OAuth to the currently selected workspace. */
export function buildJiraOAuthStartUrl(workspaceId: string | null | undefined): string {
  const params = new URLSearchParams();
  if (workspaceId?.trim()) {
    params.set('workspaceId', workspaceId.trim());
  }
  const qs = params.toString();
  return qs ? `/api/auth/jira?${qs}` : '/api/auth/jira';
}
