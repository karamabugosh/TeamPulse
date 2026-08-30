import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WebClient } from '@slack/web-api';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveActiveWorkspaceId } from '../../../common/workspace-context';
import {
  isPlaceholderSlackUser,
  isUsableSlackBotToken,
  memberDisplayLabel,
} from '../../../common/slack-member.util';
import {
  buildAiSlackExportBlocks,
  buildExportCsv,
  buildExportMarkdown,
} from './ai-slack-blocks.builder';
import { buildSimplePdf } from './simple-pdf.util';
import {
  SlackExportDestinationOption,
  SlackExportDestinationsResponse,
  SlackExportSendRequest,
  SlackExportSendResponse,
} from './ai-slack-export.types';

type WorkspaceSlackContext = {
  id: string;
  slackWorkspaceName: string;
  botToken: string;
};

type ResolvedDestination = {
  channelId: string;
  channelName: string;
  destinationType: SlackExportSendRequest['destinationType'];
};

type SlackApiErrorInfo = {
  code: string;
  message: string;
};

/**
 * Sends AI Workspace reports / answers to Slack for the active workspace only.
 * Uses the workspace's bot token (never env secrets in responses).
 */
@Injectable()
export class AiSlackExportService {
  private readonly logger = new Logger(AiSlackExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listDestinations(params: {
    workspaceId?: string | null;
  }): Promise<SlackExportDestinationsResponse> {
    const workspace = await this.requireWorkspace(params.workspaceId);
    const connected = isUsableSlackBotToken(workspace.botToken);

    const [teams, members, channels, defaultChannel] = await Promise.all([
      this.listTeamDestinations(workspace.id),
      this.listMemberDestinations(workspace.id),
      connected
        ? this.listSlackChannels(workspace.botToken)
        : Promise.resolve([] as SlackExportDestinationOption[]),
      this.resolveDefaultEngineeringChannel(workspace),
    ]);

    return {
      workspaceId: workspace.id,
      workspaceName: workspace.slackWorkspaceName,
      slackConnected: connected,
      defaultChannel: {
        channelId: defaultChannel.channelId,
        channelName: defaultChannel.channelName,
        source: defaultChannel.source,
      },
      channels,
      teams,
      members,
    };
  }

  async send(
    request: SlackExportSendRequest,
  ): Promise<SlackExportSendResponse> {
    const sentAt = new Date();
    const workspace = await this.requireWorkspace(request.workspaceId);

    if (!request.title?.trim() || !request.body?.trim()) {
      if (!request.report) {
        throw new BadRequestException(
          'title and body are required (or provide a full report).',
        );
      }
    }

    const payload: SlackExportSendRequest = {
      ...request,
      title: request.title?.trim() || request.report?.title || 'Pulse AI export',
      body:
        request.body?.trim() ||
        request.report?.markdown ||
        request.report?.explanation ||
        '',
      reportType:
        request.reportType ||
        request.report?.reportType ||
        request.contentType,
    };

    // Cross-tenant guard: report payload must match active workspace.
    if (
      payload.report?.workspaceId &&
      payload.report.workspaceId !== workspace.id
    ) {
      await this.writeLog({
        workspaceId: workspace.id,
        request: payload,
        success: false,
        errorCode: 'workspace_mismatch',
        errorMessage: 'Report belongs to a different workspace.',
        channelId: null,
        channelName: null,
        messageTs: null,
        attachments: [],
        actor: null,
      });
      return this.failureResponse(
        workspace.id,
        payload.destinationType,
        sentAt,
        'workspace_mismatch',
        'This report belongs to another workspace and cannot be sent.',
      );
    }

    if (!isUsableSlackBotToken(workspace.botToken)) {
      await this.writeLog({
        workspaceId: workspace.id,
        request: payload,
        success: false,
        errorCode: 'slack_disconnected',
        errorMessage: 'Workspace Slack bot token is missing or invalid.',
        channelId: null,
        channelName: null,
        messageTs: null,
        attachments: [],
        actor: await this.resolveActor(workspace.id, payload.actorSlackUserId),
      });
      return this.failureResponse(
        workspace.id,
        payload.destinationType,
        sentAt,
        'slack_disconnected',
        'Slack is not connected for this workspace. Reinstall the Pulse Slack app or set a valid bot token.',
      );
    }

    const client = new WebClient(workspace.botToken);
    let destination: ResolvedDestination;
    try {
      destination = await this.resolveDestination(workspace, client, payload);
    } catch (error: unknown) {
      const info = this.mapSlackError(error);
      await this.writeLog({
        workspaceId: workspace.id,
        request: payload,
        success: false,
        errorCode: info.code,
        errorMessage: info.message,
        channelId: null,
        channelName: null,
        messageTs: null,
        attachments: [],
        actor: await this.resolveActor(workspace.id, payload.actorSlackUserId),
      });
      return this.failureResponse(
        workspace.id,
        payload.destinationType,
        sentAt,
        info.code,
        info.message,
      );
    }

    const { text, blocks } = buildAiSlackExportBlocks(payload, {
      workspaceName: workspace.slackWorkspaceName,
      sentAtIso: sentAt.toISOString(),
    });

    try {
      await this.ensureBotInChannel(client, destination.channelId);

      const posted = await client.chat.postMessage({
        channel: destination.channelId,
        text,
        blocks,
      });

      if (!posted.ok) {
        const code = (posted as { error?: string }).error ?? 'slack_api_error';
        const mapped = this.mapErrorCode(code);
        await this.writeLog({
          workspaceId: workspace.id,
          request: payload,
          success: false,
          errorCode: mapped.code,
          errorMessage: mapped.message,
          channelId: destination.channelId,
          channelName: destination.channelName,
          messageTs: null,
          attachments: [],
          actor: await this.resolveActor(workspace.id, payload.actorSlackUserId),
        });
        return this.failureResponse(
          workspace.id,
          payload.destinationType,
          sentAt,
          mapped.code,
          mapped.message,
          destination,
        );
      }

      const messageTs = typeof posted.ts === 'string' ? posted.ts : null;
      const attachmentsUploaded = await this.uploadAttachments({
        client,
        channelId: destination.channelId,
        threadTs: messageTs ?? undefined,
        request: payload,
      });

      await this.writeLog({
        workspaceId: workspace.id,
        request: payload,
        success: true,
        errorCode: null,
        errorMessage: null,
        channelId: destination.channelId,
        channelName: destination.channelName,
        messageTs,
        attachments: attachmentsUploaded,
        actor: await this.resolveActor(workspace.id, payload.actorSlackUserId),
      });

      this.logger.log(
        `AI Slack export ok workspace=${workspace.id} channel=${destination.channelId} type=${payload.reportType}`,
      );

      return {
        ok: true,
        workspaceId: workspace.id,
        channelId: destination.channelId,
        channelName: destination.channelName,
        messageTs,
        sentAt: sentAt.toISOString(),
        destinationType: payload.destinationType,
        attachmentsUploaded,
        errorCode: null,
        errorMessage: null,
      };
    } catch (error: unknown) {
      const info = this.mapSlackError(error);
      await this.writeLog({
        workspaceId: workspace.id,
        request: payload,
        success: false,
        errorCode: info.code,
        errorMessage: info.message,
        channelId: destination.channelId,
        channelName: destination.channelName,
        messageTs: null,
        attachments: [],
        actor: await this.resolveActor(workspace.id, payload.actorSlackUserId),
      });
      return this.failureResponse(
        workspace.id,
        payload.destinationType,
        sentAt,
        info.code,
        info.message,
        destination,
      );
    }
  }

  private async requireWorkspace(
    preferred?: string | null,
  ): Promise<WorkspaceSlackContext> {
    const workspaceId = await resolveActiveWorkspaceId(this.prisma, preferred);
    if (!workspaceId) {
      throw new BadRequestException('No active workspace selected.');
    }
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        slackWorkspaceName: true,
        botToken: true,
      },
    });
    if (!workspace) {
      throw new BadRequestException('Workspace not found.');
    }
    return workspace;
  }

  private async listTeamDestinations(
    workspaceId: string,
  ): Promise<SlackExportDestinationOption[]> {
    const teams = await this.prisma.team.findMany({
      where: { workspaceId },
      select: { id: true, name: true, slackChannelId: true },
      orderBy: { name: 'asc' },
    });
    return teams
      .filter((team) => Boolean(team.slackChannelId?.trim()))
      .map((team) => ({
        id: team.id,
        name: team.name,
        kind: 'team' as const,
        channelId: team.slackChannelId,
      }));
  }

  private async listMemberDestinations(
    workspaceId: string,
  ): Promise<SlackExportDestinationOption[]> {
    const users = await this.prisma.user.findMany({
      where: { workspaceId },
      select: {
        id: true,
        slackUserId: true,
        slackDisplayName: true,
        slackRealName: true,
        email: true,
      },
      orderBy: { slackDisplayName: 'asc' },
      take: 200,
    });

    return users
      .filter(
        (user) =>
          !isPlaceholderSlackUser({
            slackUserId: user.slackUserId,
            slackDisplayName: user.slackDisplayName,
            email: user.email,
          }),
      )
      .map((user) => ({
        id: user.id,
        name: memberDisplayLabel(user),
        kind: 'member' as const,
        slackUserId: user.slackUserId,
      }));
  }

  private async listSlackChannels(
    botToken: string,
  ): Promise<SlackExportDestinationOption[]> {
    const client = new WebClient(botToken);
    const channels: SlackExportDestinationOption[] = [];
    let cursor: string | undefined;

    try {
      do {
        const result = await client.conversations.list({
          types: 'public_channel,private_channel',
          exclude_archived: true,
          limit: 200,
          cursor,
        });
        for (const channel of result.channels ?? []) {
          if (!channel.id || !channel.name) continue;
          if (channel.is_archived) continue;
          channels.push({
            id: channel.id,
            name: `#${channel.name}`,
            kind: 'channel',
            channelId: channel.id,
          });
        }
        cursor = result.response_metadata?.next_cursor || undefined;
      } while (cursor);
    } catch (error: unknown) {
      const info = this.mapSlackError(error);
      this.logger.warn(`Failed to list Slack channels: ${info.message}`);
      if (info.code === 'missing_scope' || info.code === 'not_allowed_token_type') {
        throw new ServiceUnavailableException(info.message);
      }
    }

    return channels.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async resolveDefaultEngineeringChannel(
    workspace: WorkspaceSlackContext,
  ): Promise<{
    channelId: string | null;
    channelName: string | null;
    source: string;
  }> {
    const engineeringTeam = await this.prisma.team.findFirst({
      where: {
        workspaceId: workspace.id,
        OR: [
          { name: { contains: 'Engineering', mode: 'insensitive' } },
          { name: { contains: 'engineering', mode: 'insensitive' } },
        ],
      },
      select: { slackChannelId: true, name: true },
      orderBy: { createdAt: 'asc' },
    });

    if (engineeringTeam?.slackChannelId?.trim()) {
      return {
        channelId: engineeringTeam.slackChannelId.trim(),
        channelName: engineeringTeam.name,
        source: 'team_engineering',
      };
    }

    const checkIn = await this.prisma.checkIn.findFirst({
      where: {
        team: { workspaceId: workspace.id },
        updatesChannelId: { not: null },
      },
      select: {
        updatesChannelId: true,
        name: true,
        team: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (checkIn?.updatesChannelId?.trim()) {
      return {
        channelId: checkIn.updatesChannelId.trim(),
        channelName: `${checkIn.team.name} / ${checkIn.name}`,
        source: 'check_in_updates_channel',
      };
    }

    const anyTeam = await this.prisma.team.findFirst({
      where: {
        workspaceId: workspace.id,
        slackChannelId: { not: null },
      },
      select: { slackChannelId: true, name: true },
      orderBy: { createdAt: 'asc' },
    });

    if (anyTeam?.slackChannelId?.trim()) {
      return {
        channelId: anyTeam.slackChannelId.trim(),
        channelName: anyTeam.name,
        source: 'first_team_channel',
      };
    }

    if (isUsableSlackBotToken(workspace.botToken)) {
      try {
        const channels = await this.listSlackChannels(workspace.botToken);
        const engineering = channels.find((channel) =>
          /engineering/i.test(channel.name),
        );
        if (engineering?.channelId) {
          return {
            channelId: engineering.channelId,
            channelName: engineering.name,
            source: 'slack_channel_name',
          };
        }
      } catch {
        // ignore — destinations endpoint can still return empty default
      }
    }

    return { channelId: null, channelName: null, source: 'none' };
  }

  private async resolveDestination(
    workspace: WorkspaceSlackContext,
    client: WebClient,
    request: SlackExportSendRequest,
  ): Promise<ResolvedDestination> {
    const type = request.destinationType;

    if (type === 'dm') {
      const slackUserId = request.slackUserId?.trim();
      if (!slackUserId) {
        throw Object.assign(new Error('Select a Slack user for DM delivery.'), {
          data: { error: 'missing_dm_user' },
        });
      }

      const member = await this.prisma.user.findFirst({
        where: { workspaceId: workspace.id, slackUserId },
        select: {
          slackUserId: true,
          slackDisplayName: true,
          slackRealName: true,
        },
      });
      if (!member) {
        throw Object.assign(
          new Error('That Slack user is not in this workspace.'),
          { data: { error: 'user_not_in_workspace' } },
        );
      }

      const opened = await client.conversations.open({
        users: slackUserId,
      });
      const channelId = opened.channel?.id;
      if (!opened.ok || !channelId) {
        throw Object.assign(new Error('Could not open a DM with that user.'), {
          data: { error: 'cannot_dm_user' },
        });
      }

      return {
        channelId,
        channelName: `DM · ${memberDisplayLabel(member)}`,
        destinationType: 'dm',
      };
    }

    if (type === 'team_channel') {
      const teamId = request.teamId?.trim();
      if (!teamId) {
        throw Object.assign(new Error('Select a team channel.'), {
          data: { error: 'missing_team' },
        });
      }
      const team = await this.prisma.team.findFirst({
        where: { id: teamId, workspaceId: workspace.id },
        select: { name: true, slackChannelId: true },
      });
      if (!team?.slackChannelId?.trim()) {
        throw Object.assign(
          new Error('That team has no Slack channel configured.'),
          { data: { error: 'team_channel_missing' } },
        );
      }
      return {
        channelId: team.slackChannelId.trim(),
        channelName: team.name,
        destinationType: 'team_channel',
      };
    }

    if (type === 'channel') {
      const channelId = request.channelId?.trim();
      if (!channelId) {
        throw Object.assign(new Error('Select a Slack channel.'), {
          data: { error: 'missing_channel' },
        });
      }
      const name = await this.lookupChannelName(client, channelId);
      return {
        channelId,
        channelName: name,
        destinationType: 'channel',
      };
    }

    // default → engineering / updates channel
    const fallback = await this.resolveDefaultEngineeringChannel(workspace);
    if (!fallback.channelId) {
      throw Object.assign(
        new Error(
          'No default engineering channel is configured for this workspace.',
        ),
        { data: { error: 'default_channel_missing' } },
      );
    }
    return {
      channelId: fallback.channelId,
      channelName: fallback.channelName ?? 'Engineering',
      destinationType: 'default',
    };
  }

  private async lookupChannelName(
    client: WebClient,
    channelId: string,
  ): Promise<string> {
    try {
      const info = await client.conversations.info({ channel: channelId });
      const name = info.channel && 'name' in info.channel
        ? info.channel.name
        : null;
      return name ? `#${name}` : channelId;
    } catch (error: unknown) {
      const info = this.mapSlackError(error);
      if (
        info.code === 'channel_not_found' ||
        info.code === 'invalid_channel'
      ) {
        throw Object.assign(new Error('Slack channel not found.'), {
          data: { error: 'channel_not_found' },
        });
      }
      throw error;
    }
  }

  private async ensureBotInChannel(
    client: WebClient,
    channelId: string,
  ): Promise<void> {
    // DMs (D…) and group DMs (G…) — skip join
    if (/^[DG]/i.test(channelId)) return;
    try {
      await client.conversations.join({ channel: channelId });
    } catch (error: unknown) {
      const info = this.mapSlackError(error);
      if (
        info.code === 'already_in_channel' ||
        info.code === 'method_not_supported_for_channel_type'
      ) {
        return;
      }
      // Private channels may fail join — still try postMessage
      this.logger.warn(
        `conversations.join ${channelId}: ${info.code} — continuing`,
      );
    }
  }

  private async uploadAttachments(params: {
    client: WebClient;
    channelId: string;
    threadTs?: string;
    request: SlackExportSendRequest;
  }): Promise<string[]> {
    const flags = params.request.attachments ?? {
      pdf: true,
      markdown: true,
      csv: Boolean(params.request.report),
    };
    const uploaded: string[] = [];
    const stamp = new Date().toISOString().slice(0, 10);
    const base =
      (params.request.reportType || params.request.contentType || 'ai')
        .replace(/[^a-z0-9_-]+/gi, '-')
        .toLowerCase() || 'ai';

    const markdown = buildExportMarkdown(params.request);
    const csv = buildExportCsv(params.request);
    const plain = [
      params.request.title,
      '',
      params.request.body || params.request.report?.markdown || '',
    ].join('\n');

    if (flags.markdown !== false) {
      const ok = await this.uploadText(params.client, {
        channelId: params.channelId,
        threadTs: params.threadTs,
        filename: `${base}-${stamp}.md`,
        title: `${params.request.title} (Markdown)`,
        content: markdown,
        comment: 'Markdown attachment',
      });
      if (ok) uploaded.push('markdown');
    }

    if (flags.csv !== false && (params.request.report || csv.includes('Body'))) {
      const ok = await this.uploadText(params.client, {
        channelId: params.channelId,
        threadTs: params.threadTs,
        filename: `${base}-${stamp}.csv`,
        title: `${params.request.title} (CSV)`,
        content: csv,
        comment: 'CSV attachment',
      });
      if (ok) uploaded.push('csv');
    }

    if (flags.pdf !== false) {
      const pdf = buildSimplePdf(params.request.title, plain);
      const ok = await this.uploadBinary(params.client, {
        channelId: params.channelId,
        threadTs: params.threadTs,
        filename: `${base}-${stamp}.pdf`,
        title: `${params.request.title} (PDF)`,
        file: pdf,
        comment: 'PDF attachment',
      });
      if (ok) uploaded.push('pdf');
    }

    return uploaded;
  }

  private async uploadText(
    client: WebClient,
    params: {
      channelId: string;
      threadTs?: string;
      filename: string;
      title: string;
      content: string;
      comment: string;
    },
  ): Promise<boolean> {
    try {
      await client.files.uploadV2({
        channel_id: params.channelId,
        thread_ts: params.threadTs,
        filename: params.filename,
        title: params.title,
        content: params.content,
        initial_comment: params.comment,
      } as never);
      return true;
    } catch (error: unknown) {
      const info = this.mapSlackError(error);
      this.logger.warn(
        `Attachment ${params.filename} failed: ${info.code} ${info.message}`,
      );
      return false;
    }
  }

  private async uploadBinary(
    client: WebClient,
    params: {
      channelId: string;
      threadTs?: string;
      filename: string;
      title: string;
      file: Buffer;
      comment: string;
    },
  ): Promise<boolean> {
    try {
      await client.files.uploadV2({
        channel_id: params.channelId,
        thread_ts: params.threadTs,
        filename: params.filename,
        title: params.title,
        file: params.file,
        initial_comment: params.comment,
      } as never);
      return true;
    } catch (error: unknown) {
      const info = this.mapSlackError(error);
      this.logger.warn(
        `Attachment ${params.filename} failed: ${info.code} ${info.message}`,
      );
      return false;
    }
  }

  private async resolveActor(
    workspaceId: string,
    slackUserId?: string | null,
  ): Promise<{ userId: string | null; slackUserId: string | null }> {
    if (!slackUserId?.trim()) {
      return { userId: null, slackUserId: null };
    }
    const user = await this.prisma.user.findFirst({
      where: { workspaceId, slackUserId: slackUserId.trim() },
      select: { id: true, slackUserId: true },
    });
    return {
      userId: user?.id ?? null,
      slackUserId: user?.slackUserId ?? slackUserId.trim(),
    };
  }

  private async writeLog(params: {
    workspaceId: string;
    request: SlackExportSendRequest;
    success: boolean;
    errorCode: string | null;
    errorMessage: string | null;
    channelId: string | null;
    channelName: string | null;
    messageTs: string | null;
    attachments: string[];
    actor: { userId: string | null; slackUserId: string | null } | null;
  }): Promise<void> {
    try {
      await this.prisma.aiSlackExportLog.create({
        data: {
          workspaceId: params.workspaceId,
          userId: params.actor?.userId ?? null,
          slackUserId: params.actor?.slackUserId ?? null,
          channelId: params.channelId,
          channelName: params.channelName,
          destinationType: params.request.destinationType,
          reportType:
            params.request.reportType ||
            params.request.report?.reportType ||
            params.request.contentType,
          title: params.request.title.slice(0, 500),
          success: params.success,
          errorCode: params.errorCode,
          errorMessage: params.errorMessage?.slice(0, 1000) ?? null,
          messageTs: params.messageTs,
          attachments: params.attachments as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to write AiSlackExportLog: ${message}`);
    }
  }

  private failureResponse(
    workspaceId: string,
    destinationType: SlackExportSendRequest['destinationType'],
    sentAt: Date,
    errorCode: string,
    errorMessage: string,
    destination?: ResolvedDestination,
  ): SlackExportSendResponse {
    return {
      ok: false,
      workspaceId,
      channelId: destination?.channelId ?? null,
      channelName: destination?.channelName ?? null,
      messageTs: null,
      sentAt: sentAt.toISOString(),
      destinationType,
      attachmentsUploaded: [],
      errorCode,
      errorMessage,
    };
  }

  private mapSlackError(error: unknown): SlackApiErrorInfo {
    const err = error as {
      message?: string;
      data?: { error?: string; needed?: string; provided?: string };
    };
    const code =
      err?.data?.error ||
      (typeof err?.message === 'string' && err.message.includes('missing_dm_user')
        ? 'missing_dm_user'
        : undefined) ||
      'slack_error';

    // Prefer structured codes we attach ourselves
    if (err?.data?.error) {
      return this.mapErrorCode(err.data.error, err.data.needed);
    }

    // Thrown with data via Object.assign
    const assigned = (error as { data?: { error?: string } })?.data?.error;
    if (assigned) {
      return this.mapErrorCode(assigned);
    }

    const message = err?.message || String(error);
    if (/missing_dm_user|Select a Slack user/i.test(message)) {
      return this.mapErrorCode('missing_dm_user');
    }
    if (/not in this workspace/i.test(message)) {
      return this.mapErrorCode('user_not_in_workspace');
    }
    if (/no Slack channel configured/i.test(message)) {
      return this.mapErrorCode('team_channel_missing');
    }
    if (/Select a Slack channel/i.test(message)) {
      return this.mapErrorCode('missing_channel');
    }
    if (/Select a team channel/i.test(message)) {
      return this.mapErrorCode('missing_team');
    }
    if (/default engineering channel/i.test(message)) {
      return this.mapErrorCode('default_channel_missing');
    }
    if (/channel not found/i.test(message)) {
      return this.mapErrorCode('channel_not_found');
    }

    return this.mapErrorCode(code, err?.data?.needed, message);
  }

  private mapErrorCode(
    code: string,
    needed?: string,
    fallbackMessage?: string,
  ): SlackApiErrorInfo {
    switch (code) {
      case 'slack_disconnected':
      case 'not_authed':
      case 'invalid_auth':
      case 'account_inactive':
      case 'token_revoked':
      case 'token_expired':
        return {
          code: 'slack_disconnected',
          message:
            'Slack is disconnected or the bot token is invalid. Reconnect the Pulse Slack app for this workspace.',
        };
      case 'missing_scope':
        return {
          code: 'missing_permissions',
          message: needed
            ? `Missing Slack permission: ${needed}. Reinstall the app with the required scopes.`
            : 'The Slack bot is missing required permissions. Reinstall the app with chat and file scopes.',
        };
      case 'not_allowed_token_type':
        return {
          code: 'missing_token',
          message: 'A Slack bot token is required for this action.',
        };
      case 'channel_not_found':
      case 'invalid_channel':
        return {
          code: 'channel_not_found',
          message:
            'That Slack channel was not found. Pick another channel or check bot access.',
        };
      case 'is_archived':
        return {
          code: 'channel_not_found',
          message: 'That Slack channel is archived.',
        };
      case 'ratelimited':
      case 'rate_limited':
        return {
          code: 'rate_limited',
          message:
            'Slack rate limited this request. Wait a moment and try again.',
        };
      case 'missing_dm_user':
        return {
          code: 'missing_dm_user',
          message: 'Select a workspace member to receive the DM.',
        };
      case 'user_not_in_workspace':
        return {
          code: 'user_not_in_workspace',
          message: 'That user is not a member of the active workspace.',
        };
      case 'cannot_dm_user':
        return {
          code: 'cannot_dm_user',
          message: 'Could not open a Slack DM with that user.',
        };
      case 'missing_channel':
        return {
          code: 'missing_channel',
          message: 'Select a Slack channel.',
        };
      case 'missing_team':
        return {
          code: 'missing_team',
          message: 'Select a team.',
        };
      case 'team_channel_missing':
        return {
          code: 'team_channel_missing',
          message: 'That team has no Slack channel configured.',
        };
      case 'default_channel_missing':
        return {
          code: 'default_channel_missing',
          message:
            'No default engineering channel is configured. Select a channel manually.',
        };
      case 'workspace_mismatch':
        return {
          code: 'workspace_mismatch',
          message: 'Cannot send a report from another workspace.',
        };
      default:
        return {
          code: code || 'slack_error',
          message:
            fallbackMessage ||
            'Failed to send to Slack. Check bot permissions and try again.',
        };
    }
  }
}
