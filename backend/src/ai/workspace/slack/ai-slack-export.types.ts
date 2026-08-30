import {
  AiChatConfidence,
  GeneratedWorkspaceReport,
} from '../types/workspace-ai.types';

export type SlackExportDestinationType =
  | 'dm'
  | 'channel'
  | 'team_channel'
  | 'default';

export type SlackExportContentType = 'report' | 'answer';

export type SlackExportAttachmentFlags = {
  pdf?: boolean;
  markdown?: boolean;
  csv?: boolean;
};

export type SlackExportSourceItem = {
  label: string;
  title?: string | null;
  url?: string | null;
};

export type SlackExportSendRequest = {
  workspaceId?: string | null;
  destinationType: SlackExportDestinationType;
  /** Slack channel ID when destinationType is `channel`. */
  channelId?: string | null;
  /** Pulse team ID when destinationType is `team_channel`. */
  teamId?: string | null;
  /** Slack user to DM when destinationType is `dm`. */
  slackUserId?: string | null;
  /** Optional actor for audit (web may omit). */
  actorSlackUserId?: string | null;
  contentType: SlackExportContentType;
  title: string;
  body: string;
  confidence?: AiChatConfidence | string | null;
  sources?: SlackExportSourceItem[];
  recommendation?: string | null;
  reportType?: string | null;
  /** Full structured report — used for richer blocks + file attachments. */
  report?: GeneratedWorkspaceReport | null;
  attachments?: SlackExportAttachmentFlags | null;
};

export type SlackExportDestinationOption = {
  id: string;
  name: string;
  kind: 'channel' | 'team' | 'member';
  channelId?: string | null;
  slackUserId?: string | null;
  isDefault?: boolean;
};

export type SlackExportDestinationsResponse = {
  workspaceId: string;
  workspaceName: string;
  slackConnected: boolean;
  defaultChannel: {
    channelId: string | null;
    channelName: string | null;
    source: string;
  };
  channels: SlackExportDestinationOption[];
  teams: SlackExportDestinationOption[];
  members: SlackExportDestinationOption[];
};

export type SlackExportSendResponse = {
  ok: boolean;
  workspaceId: string;
  channelId: string | null;
  channelName: string | null;
  messageTs: string | null;
  sentAt: string;
  destinationType: SlackExportDestinationType;
  attachmentsUploaded: string[];
  errorCode?: string | null;
  errorMessage?: string | null;
};
