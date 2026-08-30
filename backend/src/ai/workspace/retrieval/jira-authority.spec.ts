import * as assert from 'assert';
import {
  CONVERSATIONAL_CONTEXT_BANNER,
  hasAuthoritativeJiraFields,
  isLiveJiraDocument,
  sanitizeConversationalJiraFields,
} from './jira-authority.util';
import { documentAuthorityClass } from '../../../memory/memory-evidence.adapter';
import { KnowledgeDocument } from '../types/workspace-ai.types';

function jiraDoc(meta: Record<string, unknown>): KnowledgeDocument {
  return {
    id: 'jira:SCRUM-9',
    workspaceId: 'ws-1',
    source: 'jira',
    entity: 'jira_issue',
    title: 'SCRUM-9',
    content: 'Key: SCRUM-9',
    timestamp: null,
    url: null,
    reference: {
      source: 'jira',
      entity: 'jira_issue',
      entityId: 'SCRUM-9',
      timestamp: null,
      workspaceId: 'ws-1',
      url: null,
      label: 'jira:jira_issue:SCRUM-9',
    },
    metadata: meta,
  };
}

// Live Jira is authoritative
{
  const live = jiraDoc({
    liveRefreshed: true,
    authoritativeJiraFields: true,
    hasLiveJiraConnection: true,
  });
  assert.equal(isLiveJiraDocument(live), true);
  assert.equal(hasAuthoritativeJiraFields(live), true);
  assert.equal(documentAuthorityClass(live), 'LIVE_JIRA_CURRENT');
  console.log('✓ Live Jira document is LIVE_JIRA_CURRENT and authoritative');
}

// Stale cache with live connection is NOT authoritative
{
  const stale = jiraDoc({
    liveRefreshed: false,
    authoritativeJiraFields: true,
    hasLiveJiraConnection: true,
    jiraSource: 'Cache',
  });
  assert.equal(isLiveJiraDocument(stale), false);
  assert.equal(hasAuthoritativeJiraFields(stale), false);
  assert.equal(documentAuthorityClass(stale), 'LEGACY_SUPPORTING');
  console.log('✓ Stale cache with live connection is not authoritative');
}

// Offline cache without live connection IS authoritative for fields
{
  const offline = jiraDoc({
    liveRefreshed: false,
    authoritativeJiraFields: true,
    hasLiveJiraConnection: false,
    jiraSource: 'Cache',
  });
  assert.equal(hasAuthoritativeJiraFields(offline), true);
  assert.equal(documentAuthorityClass(offline), 'LEGACY_SUPPORTING');
  console.log('✓ Offline cache remains authoritative when no live connection');
}

// Conversational sources strip embedded Jira field lines
{
  const raw = [
    'Karam mentioned SCRUM-9 in standup.',
    'Status: Done (stale from standup — must strip)',
    'Assignee: Alice (wrong)',
  ].join('\n');
  const sanitized = sanitizeConversationalJiraFields(raw);
  assert.ok(!/Status:\s*Done/i.test(sanitized));
  assert.ok(!/Assignee:\s*Alice/i.test(sanitized));
  assert.ok(/Conversational context only/i.test(sanitized));
  assert.ok(CONVERSATIONAL_CONTEXT_BANNER.includes('Do NOT use'));
  console.log('✓ Standup/Slack content strips non-authoritative Jira field lines');
}

console.log('\nAll jira-authority tests passed.');
