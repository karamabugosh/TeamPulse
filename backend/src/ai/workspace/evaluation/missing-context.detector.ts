import { RetrievalDiagnostics } from '../types/workspace-ai.types';

export type MissingContextFinding = {
  code:
    | 'missing_jira_issue'
    | 'missing_standup'
    | 'missing_slack_thread'
    | 'missing_blocker'
    | 'missing_report'
    | 'missing_team_memory'
    | 'missing_user'
    | 'insufficient_data'
    | 'unknown';
  label: string;
  detail: string;
};

export type MissingContextAssessment = {
  findings: MissingContextFinding[];
  penalty: number;
  detected: boolean;
};

const MISSING_ANSWER_RE =
  /not found|no (data|records|information|standup|issue|member|user|blocker)|insufficient|don't have|do not have|couldn't find|could not find|missing/i;

/**
 * Detect when the model could not answer due to missing workspace context.
 */
export function detectMissingContext(input: {
  question: string;
  aiAnswer: string;
  insufficientData?: boolean;
  diagnostics?: RetrievalDiagnostics | null;
  tags?: string[];
}): MissingContextAssessment {
  const findings: MissingContextFinding[] = [];
  const answer = input.aiAnswer;
  const question = input.question.toLowerCase();

  const answerSuggestsMissing = MISSING_ANSWER_RE.test(answer);
  const flaggedInsufficient = Boolean(input.insufficientData);

  if (input.diagnostics?.sources?.length) {
    for (const source of input.diagnostics.sources) {
      if (!source.searched) continue;
      if (source.found > 0) continue;
      if (source.reasonCode === 'ok') continue;

      const mapped = mapSourceKey(source.sourceKey, source.label, source.reason);
      if (mapped) findings.push(mapped);
    }
  }

  if (flaggedInsufficient || answerSuggestsMissing) {
    if (/scrum-|jira|issue/i.test(question)) {
      findings.push({
        code: 'missing_jira_issue',
        label: 'Missing Jira Issue',
        detail: 'Answer or retrieval indicates the requested Jira issue was unavailable.',
      });
    }
    if (/standup|stand-up|check-?in/i.test(question)) {
      findings.push({
        code: 'missing_standup',
        label: 'Missing Standup',
        detail: 'Standup context appears missing or empty for this question.',
      });
    }
    if (/slack|thread|conversation/i.test(question)) {
      findings.push({
        code: 'missing_slack_thread',
        label: 'Missing Slack Thread',
        detail: 'Slack thread / conversation context appears missing.',
      });
    }
    if (/blocker/i.test(question)) {
      findings.push({
        code: 'missing_blocker',
        label: 'Missing Blocker',
        detail: 'Blocker records appear missing for this question.',
      });
    }
    if (/team memory|architecture decision/i.test(question)) {
      findings.push({
        code: 'missing_team_memory',
        label: 'Missing Team Memory',
        detail: 'Team memory documents appear missing.',
      });
    }
    if (/who is|what did|member|user/i.test(question)) {
      findings.push({
        code: 'missing_user',
        label: 'Missing User',
        detail: 'User / member context appears missing.',
      });
    }

    if (findings.length === 0) {
      findings.push({
        code: 'insufficient_data',
        label: 'Insufficient Data',
        detail: 'Model indicated missing context without a specific source.',
      });
    }
  }

  // Deduplicate by code
  const unique = new Map<string, MissingContextFinding>();
  for (const finding of findings) {
    unique.set(finding.code, finding);
  }
  const list = Array.from(unique.values());

  // Missing-context on hallucination-trap cases is expected → low penalty
  const expectedMissing = Boolean(input.tags?.includes('hallucination-trap'));
  const penalty = list.length === 0
    ? 0
    : expectedMissing
      ? 5
      : Math.min(40, list.length * 12);

  return {
    findings: list,
    penalty,
    detected: list.length > 0,
  };
}

function mapSourceKey(
  sourceKey: string,
  label: string,
  reason: string,
): MissingContextFinding | null {
  const key = sourceKey.toLowerCase();
  if (key.includes('jira')) {
    return {
      code: 'missing_jira_issue',
      label: 'Missing Jira Issue',
      detail: `${label}: ${reason}`,
    };
  }
  if (key.includes('standup')) {
    return {
      code: 'missing_standup',
      label: 'Missing Standup',
      detail: `${label}: ${reason}`,
    };
  }
  if (key.includes('slack') || key.includes('thread')) {
    return {
      code: 'missing_slack_thread',
      label: 'Missing Slack Thread',
      detail: `${label}: ${reason}`,
    };
  }
  if (key.includes('blocker')) {
    return {
      code: 'missing_blocker',
      label: 'Missing Blocker',
      detail: `${label}: ${reason}`,
    };
  }
  if (key.includes('report') || key.includes('digest')) {
    return {
      code: 'missing_report',
      label: 'Missing Report',
      detail: `${label}: ${reason}`,
    };
  }
  if (key.includes('memory')) {
    return {
      code: 'missing_team_memory',
      label: 'Missing Team Memory',
      detail: `${label}: ${reason}`,
    };
  }
  if (key.includes('user')) {
    return {
      code: 'missing_user',
      label: 'Missing User',
      detail: `${label}: ${reason}`,
    };
  }
  return {
    code: 'unknown',
    label: label || 'Missing Context',
    detail: reason,
  };
}
