# Jira Integration Configuration Contract

## Purpose

Pulse integrates with different Jira Cloud workspaces without hardcoding
projects, issue types, statuses, transitions, or workflows.

## Configuration Hierarchy

Configuration is resolved in this order:

1. System safety rules
2. Workspace Jira settings
3. Team Jira settings
4. Question Jira settings
5. Per-user Jira connection and permissions

Lower levels may customize behavior but cannot disable system safety rules.

## Workspace Configuration

A workspace administrator can configure:

- Jira Cloud site connection
- Enabled and default Jira projects
- Metadata cache duration
- Jira integration enabled or disabled
- Connection health and last successful synchronization

Project metadata must be retrieved from Jira dynamically.

## Team Configuration

Each Pulse team can configure:

- Whether Jira ticket selection is enabled
- Whether Jira activity prefill is enabled
- Whether Pulse may propose:
  - Jira comments
  - Issue transitions
  - Blocker artifacts
  - Issue links
  - New issue creation
- Default Jira project for the team

## Question Configuration

A Check-In question can configure:

- Question type: ISSUE_REF
- Single or multiple issue selection
- Allowed Jira projects
- Plain-text fallback
- Whether the answer may produce an AI Jira action proposal

## User Connection

Each user connects their own Jira identity using Atlassian OAuth 2.0 (3LO).

Pulse must:

- Encrypt OAuth tokens at rest
- Respect the user's Jira permissions
- Never request passwords or API tokens through Slack
- Continue the Check-In using plain text when Jira is unavailable

## Dynamic Jira Metadata

Pulse retrieves the following dynamically from Jira:

- Projects
- Issue types
- Required fields
- Issues
- Statuses
- Allowed transitions
- Boards and sprints where available

These values must not be hardcoded in the application.

## AI Agent Boundaries

The agent workflow is:

1. Understand the Check-In answer
2. Extract or link the Jira issue
3. Inspect the current Jira issue
4. Retrieve currently allowed actions
5. Recommend a specific action
6. Persist the proposal
7. Ask the user privately
8. Allow approve, edit, or dismiss
9. Revalidate Jira state and permissions
10. Execute the approved action once
11. Confirm the result
12. Write an audit record

The AI must never call Jira write APIs directly.

## Write Safety Rules

The following rules cannot be disabled from the Dashboard:

- Human approval before every Jira write
- Revalidation before execution
- Access control checks
- Encrypted OAuth tokens
- Idempotent execution
- Audit logging
- Graceful plain-text fallback
- No performance or employee-surveillance scoring

## Failure Behaviour

If Jira is disconnected, unavailable, or the user lacks permission:

- The Check-In must continue
- The user may enter a plain-text answer
- Pulse must explain the Jira limitation clearly
- No data-changing action is attempted
