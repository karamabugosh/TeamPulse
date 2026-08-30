/**
 * Shared Demo Workspace constants (isolation keys only — no fake people).
 * Demo never calls the live Slack API; DEMO_BOT_TOKEN is a non-usable placeholder.
 */

export const DEMO_SLACK_WORKSPACE_ID = 'T_DEMO_PULSE_WS';
export const DEMO_WORKSPACE_NAME = 'Demo Workspace';
/** Placeholder only — rejected by isUsableSlackBotToken(); never used for Web API. */
export const DEMO_BOT_TOKEN = 'xoxb-demo-pulse-placeholder';
export const DEMO_CHANNEL_ID = 'C_DEMO_STANDUP';
export const DEMO_PLATFORM_CHANNEL_ID = 'C_DEMO_PLATFORM';
export const DEMO_GENERAL_CHANNEL_ID = 'C_DEMO_GENERAL';
export const DEMO_RANDOM_CHANNEL_ID = 'C_DEMO_RANDOM';
export const DEMO_PROJECT_KEY = 'SCRUM';
export const DEMO_SITE_URL = 'https://demo.atlassian.net';
export const DEMO_TIMEZONE = 'Asia/Riyadh';
export const DEMO_CLOUD_ID = 'demo-cloud-id';

/** Fingerprint document sourceId inside Demo Team Memory. */
export const DEMO_MEMBER_FINGERPRINT_SOURCE = 'demo-jira-member-fingerprint';

export const DEMO_SPRINT_14 = {
  name: 'Sprint 14',
  fromDayOffset: 21,
  toDayOffset: 7,
} as const;

export const DEMO_VACATION = {
  /** Slot into member list (backend-ish role). */
  memberSlot: 2,
  fromDayOffset: 18,
  toDayOffset: 12,
} as const;
