/**
 * Gold-answer evaluation dataset for AI Workspace.
 * Cases are workspace-agnostic templates; runner seeds them per workspaceId.
 * Demo narrative anchors (SCRUM-*, Sara/Nora/Layla) match Demo Workspace seed.
 */

export type AiEvalCategory =
  | 'Jira'
  | 'Standups'
  | 'Blockers'
  | 'Reports'
  | 'Team Memory'
  | 'Slack'
  | 'Executive Reports'
  | 'Project Detective';

export type GoldEvalCaseTemplate = {
  id: string;
  category: AiEvalCategory;
  question: string;
  expectedAnswer: string;
  expectedSources: string[];
  expectedConfidence: 'High' | 'Medium' | 'Low';
  tags: string[];
  /** Key phrases that should appear for completeness scoring. */
  mustInclude?: string[];
};

export const GOLD_EVAL_DATASET: GoldEvalCaseTemplate[] = [
  {
    id: 'jira-scrum-8-status',
    category: 'Jira',
    question: 'What is the status of SCRUM-8?',
    expectedAnswer:
      'SCRUM-8 is Sara Alami’s OAuth consent UI ticket. It was delayed while blocked on the OAuth callback (SCRUM-12), then moved toward In Review after Nora fixed the callback.',
    expectedSources: ['jira', 'standups', 'team_memory'],
    expectedConfidence: 'High',
    tags: ['scrum-8', 'oauth', 'status'],
    mustInclude: ['SCRUM-8', 'Sara', 'OAuth'],
  },
  {
    id: 'jira-scrum-8-delay',
    category: 'Jira',
    question: 'Why was SCRUM-8 delayed?',
    expectedAnswer:
      'SCRUM-8 slipped because Sara was blocked waiting for the OAuth callback (SCRUM-12 401s after credential rotation), plus marketplace/legal review on SCRUM-33.',
    expectedSources: ['jira', 'blockers', 'standups'],
    expectedConfidence: 'High',
    tags: ['scrum-8', 'delay', 'oauth'],
    mustInclude: ['SCRUM-8', 'blocked', 'OAuth', 'SCRUM-12'],
  },
  {
    id: 'jira-missing-issue',
    category: 'Jira',
    question: 'What is the status of SCRUM-9999?',
    expectedAnswer:
      'There is no SCRUM-9999 issue in the workspace data. The AI should say the issue was not found rather than invent a status.',
    expectedSources: ['jira'],
    expectedConfidence: 'Low',
    tags: ['missing', 'hallucination-trap'],
    mustInclude: ['not found', 'SCRUM-9999'],
  },
  {
    id: 'standup-today',
    category: 'Standups',
    question: "Summarize today's standup.",
    expectedAnswer:
      'Summarize completed standup submissions for the active workspace: who responded, themes of work, and any blockers called out.',
    expectedSources: ['slack', 'standup_runs', 'standups'],
    expectedConfidence: 'Medium',
    tags: ['standup', 'summary'],
    mustInclude: ['standup'],
  },
  {
    id: 'standup-sara',
    category: 'Standups',
    question: 'What did Sara work on in standup?',
    expectedAnswer:
      'Sara reported OAuth login work for SCRUM-8, being blocked on the backend callback, plus related frontend tickets like filters/switcher.',
    expectedSources: ['slack', 'standups', 'jira'],
    expectedConfidence: 'High',
    tags: ['sara', 'standup'],
    mustInclude: ['Sara', 'OAuth', 'SCRUM-8'],
  },
  {
    id: 'blockers-who',
    category: 'Blockers',
    question: 'Who is blocked today?',
    expectedAnswer:
      'List open Pulse blockers and reporters for the workspace, highlighting critical-path OAuth/infra blockers when present.',
    expectedSources: ['blockers', 'standups'],
    expectedConfidence: 'Medium',
    tags: ['blockers', 'open'],
    mustInclude: ['block'],
  },
  {
    id: 'blockers-oauth',
    category: 'Blockers',
    question: 'Who is blocked on Jira OAuth?',
    expectedAnswer:
      'Sara Alami was blocked on Jira OAuth waiting for Nora’s SCRUM-12 callback/token refresh fix.',
    expectedSources: ['blockers', 'jira', 'standups'],
    expectedConfidence: 'High',
    tags: ['oauth', 'blocker'],
    mustInclude: ['Sara', 'OAuth'],
  },
  {
    id: 'blockers-resolver',
    category: 'Blockers',
    question: 'Which developer resolved the most blockers?',
    expectedAnswer:
      'Nora Farid resolved the most critical-path blockers (OAuth callback / SCRUM-12), unblocking Sara on SCRUM-8.',
    expectedSources: ['blockers', 'jira'],
    expectedConfidence: 'Medium',
    tags: ['blockers', 'resolver'],
    mustInclude: ['Nora'],
  },
  {
    id: 'reports-sprint',
    category: 'Reports',
    question: 'Generate sprint report',
    expectedAnswer:
      'Sprint report covering Done / In Progress / Blocked work, with SCRUM-8 delay and infra risks called out when present.',
    expectedSources: ['reports', 'jira', 'standups', 'blockers'],
    expectedConfidence: 'High',
    tags: ['sprint', 'report'],
    mustInclude: ['Sprint', 'SCRUM'],
  },
  {
    id: 'reports-weekly',
    category: 'Reports',
    question: 'Generate weekly report',
    expectedAnswer:
      'Weekly workspace report with participation, Jira progress, blockers, and recommendations grounded in workspace metrics.',
    expectedSources: ['reports', 'standups', 'jira', 'blockers'],
    expectedConfidence: 'High',
    tags: ['weekly', 'report'],
    mustInclude: ['week'],
  },
  {
    id: 'executive-last-sprint',
    category: 'Executive Reports',
    question: 'Generate an executive report for the last sprint',
    expectedAnswer:
      'Executive summary of Sprint 14: delivery vs risk, OAuth critical path (SCRUM-8/12), marketplace/legal delay (SCRUM-33), infra open items, and a clear recommendation.',
    expectedSources: ['reports', 'jira', 'blockers'],
    expectedConfidence: 'High',
    tags: ['executive', 'sprint-14'],
    mustInclude: ['Sprint', 'OAuth', 'recommend'],
  },
  {
    id: 'detective-scrum-8',
    category: 'Project Detective',
    question: 'Investigate SCRUM-8 root cause',
    expectedAnswer:
      'Root-cause analysis: Sara blocked on OAuth callback ownership (SCRUM-12), marketplace/legal (SCRUM-33), timeline of delay, and recommended ownership fixes.',
    expectedSources: ['jira', 'blockers', 'standups', 'team_memory'],
    expectedConfidence: 'High',
    tags: ['detective', 'root-cause', 'scrum-8'],
    mustInclude: ['SCRUM-8', 'root', 'OAuth', 'SCRUM-12'],
  },
  {
    id: 'detective-replay-sprint',
    category: 'Project Detective',
    question: 'Replay Sprint 14',
    expectedAnswer:
      'Sprint 14 replay: OAuth callback blockage → SCRUM-8 delay → later Review; Nora PTO mid-sprint; infra issues from Haya.',
    expectedSources: ['reports', 'standups', 'jira', 'blockers'],
    expectedConfidence: 'High',
    tags: ['sprint-14', 'replay'],
    mustInclude: ['Sprint 14', 'OAuth', 'SCRUM-8'],
  },
  {
    id: 'team-memory-oauth',
    category: 'Team Memory',
    question: 'What architecture decision covers OAuth callback ownership?',
    expectedAnswer:
      'Team memory notes that Atlassian OAuth callback and token refresh live in the Nest Jira module (Nora / SCRUM-12); frontend only handles consent UI (Sara / SCRUM-8).',
    expectedSources: ['team_memory', 'jira'],
    expectedConfidence: 'High',
    tags: ['architecture', 'oauth'],
    mustInclude: ['OAuth', 'backend', 'SCRUM-12'],
  },
  {
    id: 'team-memory-workspace-header',
    category: 'Team Memory',
    question: 'How does Pulse isolate workspaces in APIs?',
    expectedAnswer:
      'APIs resolve the active tenant from X-Workspace-Id so Demo Workspace data never bleeds into other workspaces.',
    expectedSources: ['team_memory'],
    expectedConfidence: 'Medium',
    tags: ['workspace', 'isolation'],
    mustInclude: ['workspace', 'X-Workspace-Id'],
  },
  {
    id: 'slack-oauth-conversations',
    category: 'Slack',
    question: 'Show all AI conversations related to OAuth',
    expectedAnswer:
      'OAuth-related Slack/AI threads center on SCRUM-8 (Sara), SCRUM-12 (Nora), and SCRUM-33 (Layla): callback failures, marketplace wording, and Sprint 14 delay callouts.',
    expectedSources: ['slack', 'reports', 'jira'],
    expectedConfidence: 'Medium',
    tags: ['slack', 'oauth'],
    mustInclude: ['OAuth', 'SCRUM-8', 'SCRUM-12'],
  },
  {
    id: 'user-activity-sara',
    category: 'Standups',
    question: 'What did Sara do last week?',
    expectedAnswer:
      'Sara implemented OAuth login for SCRUM-8, reported being blocked on backend callback, worked related tickets, then moved SCRUM-8 to In Review after the callback landed.',
    expectedSources: ['standups', 'jira', 'slack'],
    expectedConfidence: 'High',
    tags: ['sara', 'activity'],
    mustInclude: ['Sara', 'SCRUM-8', 'OAuth'],
  },
  {
    id: 'user-missing',
    category: 'Slack',
    question: 'What did Zephyr Quantum work on yesterday?',
    expectedAnswer:
      'No workspace member named Zephyr Quantum exists. The AI should say the user was not found instead of inventing activity.',
    expectedSources: ['users', 'standups'],
    expectedConfidence: 'Low',
    tags: ['missing-user', 'hallucination-trap'],
    mustInclude: ['not found', 'Zephyr'],
  },
  {
    id: 'workload-highest',
    category: 'Reports',
    question: 'Who has the highest workload?',
    expectedAnswer:
      'Nora Farid and Sara Alami typically carry the heaviest SCRUM assignment counts (backend/AI + OAuth frontend).',
    expectedSources: ['jira', 'team_memory', 'users'],
    expectedConfidence: 'Medium',
    tags: ['workload'],
    mustInclude: ['Nora', 'Sara'],
  },
  {
    id: 'vacation-nora',
    category: 'Reports',
    question: 'Catch me up on my vacation',
    expectedAnswer:
      'Vacation catch-up should clarify dates or, for Nora’s PTO window, summarize OAuth blockage on SCRUM-8 and infra issues that happened while away.',
    expectedSources: ['standups', 'reports', 'jira', 'blockers'],
    expectedConfidence: 'Medium',
    tags: ['vacation'],
    mustInclude: ['vacation'],
  },
];

export function listGoldCategories(): AiEvalCategory[] {
  return Array.from(new Set(GOLD_EVAL_DATASET.map((item) => item.category)));
}
