import { Logger } from '@nestjs/common';

/** Minimal surface of Bolt SocketModeReceiver.client — avoids a direct TS import from @slack/socket-mode. */
export type SlackSocketModeClient = {
  on(
    event:
      | 'connecting'
      | 'connected'
      | 'authenticated'
      | 'reconnecting'
      | 'disconnecting'
      | 'disconnected'
      | 'error',
    listener: (...args: unknown[]) => void,
  ): void;
};

export type SlackSocketConfig = {
  botToken?: string;
  signingSecret?: string;
  appToken?: string;
  socketModeEnabled: boolean;
};

export type SlackSocketValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export function validateSlackSocketConfig(
  config: SlackSocketConfig,
): SlackSocketValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.socketModeEnabled) {
    return { ok: true, errors, warnings };
  }

  if (!config.botToken?.trim()) {
    errors.push('SLACK_BOT_TOKEN is missing.');
  } else if (!config.botToken.startsWith('xoxb-')) {
    warnings.push('SLACK_BOT_TOKEN does not start with "xoxb-".');
  }

  if (!config.signingSecret?.trim()) {
    errors.push('SLACK_SIGNING_SECRET is missing.');
  }

  if (!config.appToken?.trim()) {
    errors.push('SLACK_APP_TOKEN is missing.');
  } else if (!config.appToken.startsWith('xapp-')) {
    errors.push(
      'SLACK_APP_TOKEN must be an App-Level Token starting with "xapp-".',
    );
  }

  warnings.push(
    'Ensure Socket Mode is enabled in the Slack app settings and the App-Level Token includes the "connections:write" scope.',
  );
  warnings.push(
    'If permissions changed recently, reinstall the app to the workspace.',
  );

  return { ok: errors.length === 0, errors, warnings };
}

export function maskToken(token?: string): string {
  if (!token) {
    return '(missing)';
  }
  if (token.length <= 12) {
    return `${token.slice(0, 4)}…`;
  }
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

export function attachSocketLifecycleLogging(
  client: SlackSocketModeClient,
  logger: Logger,
): void {
  client.on('connecting', () => {
    logger.log('[Slack Socket] connecting…');
  });

  client.on('connected', () => {
    logger.log('[Slack Socket] connected');
  });

  client.on('authenticated', () => {
    logger.log(
      '[Slack Socket] authenticated (apps.connections.open succeeded)',
    );
  });

  client.on('reconnecting', () => {
    logger.warn('[Slack Socket] reconnecting…');
  });

  client.on('disconnecting', () => {
    logger.warn('[Slack Socket] disconnecting…');
  });

  client.on('disconnected', (error?: unknown) => {
    if (error) {
      logger.warn(
        `[Slack Socket] disconnected: ${formatSocketError(error)}`,
      );
      return;
    }
    logger.warn('[Slack Socket] disconnected');
  });

  client.on('error', (error: unknown) => {
    logger.error(
      `[Slack Socket] client error: ${formatSocketError(error)}`,
    );
  });
}

export function isSocketDisconnectCrash(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error ?? '');
  return message.includes('server explicit disconnect');
}

export function formatSocketError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Prevents legacy socket-mode finity crashes from taking down the Nest process. */
export function registerSocketDisconnectGuard(
  onDisconnect: (reason: string) => void,
  logger: Logger,
): void {
  if (registerSocketDisconnectGuard.registered) {
    return;
  }
  registerSocketDisconnectGuard.registered = true;

  process.on('uncaughtException', (error: Error) => {
    if (!isSocketDisconnectCrash(error)) {
      logger.error(`Uncaught exception: ${error.message}`, error.stack);
      process.exit(1);
      return;
    }

    logger.error(
      `[Slack Socket] Swallowed unhandled disconnect crash: ${error.message}`,
    );
    onDisconnect('server explicit disconnect (uncaughtException)');
  });
}
registerSocketDisconnectGuard.registered = false;
