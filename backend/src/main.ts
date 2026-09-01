import { IncomingMessage, ServerResponse } from 'http';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import {
  getJiraEnvDiagnostics,
  resolveBackendEnvPath,
} from './config/env.config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { runWithWorkspaceId } from './common/workspace-context';

const envFilePath = resolveBackendEnvPath();
loadEnv({ path: envFilePath });

async function bootstrap(): Promise<void> {
  // Log only whether secrets are set, never their actual values
  console.log('Env file:', envFilePath, '(exists:', existsSync(envFilePath), ')');
  console.log('SLACK_BOT_TOKEN set:', !!process.env.SLACK_BOT_TOKEN);
  console.log('SLACK_SIGNING_SECRET set:', !!process.env.SLACK_SIGNING_SECRET);
  console.log('SLACK_APP_TOKEN set:', !!process.env.SLACK_APP_TOKEN);
  const jiraDiagnostics = getJiraEnvDiagnostics();
  console.log('JIRA_CLIENT_ID set:', jiraDiagnostics.jiraClientIdSet);
  console.log('JIRA_CLIENT_SECRET set:', jiraDiagnostics.jiraClientSecretSet);
  console.log('JIRA_REDIRECT_URI set:', jiraDiagnostics.jiraRedirectUriSet);
  const appToken = process.env.SLACK_APP_TOKEN ?? '';
  if (appToken && !appToken.startsWith('xapp-')) {
    console.warn(
      'SLACK_APP_TOKEN should be an App-Level Token starting with "xapp-".',
    );
  }

  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: resolveCorsOrigin(),
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Workspace-Id',
      'X-Requested-With',
    ],
    exposedHeaders: ['X-Workspace-Id'],
  });
  app.setGlobalPrefix('api');

  // Propagate selected workspace to AsyncLocalStorage for tenant-scoped queries
  app.use((req: IncomingMessage, _res: ServerResponse, next: () => void) => {
    const raw = req.headers['x-workspace-id'];
    const workspaceId = Array.isArray(raw) ? raw[0] : raw;
    runWithWorkspaceId(workspaceId?.trim() || null, () => next());
  });

  // Render (and most PaaS hosts) inject PORT; bind all interfaces for the proxy.
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://localhost:${port}`);
}

/**
 * Production: restrict to FRONTEND_URL and/or comma-separated CORS_ORIGINS.
 * Local/dev without those vars: allow any origin (previous default behavior).
 */
function normalizeOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url.trim().replace(/\/+$/, '');
  }
}

function collectAllowedOrigins(): string[] {
  const origins = new Set<string>();

  for (const value of (process.env.CORS_ORIGINS ?? '').split(',')) {
    const trimmed = value.trim();
    if (trimmed) origins.add(normalizeOrigin(trimmed));
  }

  const frontendUrl = process.env.FRONTEND_URL?.trim();
  if (frontendUrl) {
    origins.add(normalizeOrigin(frontendUrl));
  }

  return [...origins];
}

function resolveCorsOrigin():
  | boolean
  | string[]
  | ((
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => void) {
  const allowed = collectAllowedOrigins();
  if (allowed.length === 0) {
    return true;
  }

  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    callback(null, allowed.includes(normalizeOrigin(origin)));
  };
}

void bootstrap();
