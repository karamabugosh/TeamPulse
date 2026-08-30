import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Candidate .env locations for the NestJS backend.
 * Supports running from pulse/, pulse/backend/, or compiled dist/.
 */
export function resolveBackendEnvPaths(): string[] {
  const candidates = [
    join(process.cwd(), '.env'),
    join(process.cwd(), 'backend', '.env'),
    join(__dirname, '..', '..', '.env'),
    join(__dirname, '..', '.env'),
  ];

  return candidates.filter(
    (candidate, index) => candidates.indexOf(candidate) === index,
  );
}

export function resolveBackendEnvPath(): string {
  return (
    resolveBackendEnvPaths().find((candidate) => existsSync(candidate)) ??
    join(process.cwd(), '.env')
  );
}

export function isEnvVarSet(key: string): boolean {
  return Boolean(readEnvVar(key));
}

export function readEnvVar(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

export function getJiraEnvDiagnostics(): {
  cwd: string;
  envFilePath: string;
  envFileExists: boolean;
  jiraClientIdSet: boolean;
  jiraClientSecretSet: boolean;
  jiraRedirectUriSet: boolean;
  jiraAuthUrlSet: boolean;
  jiraTokenUrlSet: boolean;
  jiraApiUrlSet: boolean;
  jiraScopesSet: boolean;
  frontendUrlSet: boolean;
} {
  const envFilePath = resolveBackendEnvPath();

  return {
    cwd: process.cwd(),
    envFilePath,
    envFileExists: existsSync(envFilePath),
    jiraClientIdSet: isEnvVarSet('JIRA_CLIENT_ID'),
    jiraClientSecretSet: isEnvVarSet('JIRA_CLIENT_SECRET'),
    jiraRedirectUriSet: isEnvVarSet('JIRA_REDIRECT_URI'),
    jiraAuthUrlSet: isEnvVarSet('JIRA_AUTH_URL'),
    jiraTokenUrlSet: isEnvVarSet('JIRA_TOKEN_URL'),
    jiraApiUrlSet: isEnvVarSet('JIRA_API_URL'),
    jiraScopesSet: isEnvVarSet('JIRA_SCOPES'),
    frontendUrlSet: isEnvVarSet('FRONTEND_URL'),
  };
}
