/**
 * Demo Workspace constants re-export (isolation keys only).
 *
 * Demo is NOT a separate data system. It is a normal Workspace row in PostgreSQL
 * (`slackWorkspaceId = T_DEMO_PULSE_WS`) seeded by:
 *   - DemoWorkspaceGeneratorService.seedDemoWorkspace / generateDemoWorkspace
 *   - buildDemoWorkspaceFromJiraMembers
 *
 * Product APIs and the AI pipeline filter only by workspaceId � identical for Demo and Real.
 */

export {
  DEMO_SLACK_WORKSPACE_ID,
  DEMO_WORKSPACE_NAME,
  DEMO_BOT_TOKEN,
  DEMO_CHANNEL_ID,
  DEMO_PLATFORM_CHANNEL_ID,
  DEMO_PROJECT_KEY,
  DEMO_SITE_URL,
  DEMO_TIMEZONE,
  DEMO_SPRINT_14,
  DEMO_VACATION,
} from '../../src/demo/demo.constants';
