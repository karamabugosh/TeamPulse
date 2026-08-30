import { QuestionType } from '@prisma/client';
import {
  enrichAnswerForAnalysis,
  getSemanticSentiment,
  parseYesNoChoice,
} from '../common/question-semantics';
import { formatAnswerForDisplay } from '../jira/jira-issue-ref.types';
import { lookupSlackDisplayName } from '../common/slack-member.util';
import {
  ExtractedBlocker,
  NamedPersonSection,
  ParticipantProfile,
  ReportStatistics,
} from '../ai/dto/ai-result.dto';

type SubmissionInput = {
  status: string;
  answers: Array<{
    text: string;
    structuredValue?: unknown;
    question: { question: string; type: QuestionType; order?: number };
  }>;
  user: { slackUserId: string; slackDisplayName: string };
};

type QuestionRole =
  | 'yesterday'
  | 'today'
  | 'blocked'
  | 'confidence'
  | 'help'
  | 'status'
  | 'other';

const YESTERDAY_PATTERN =
  /\b(yesterday|previous day|what did you|accomplish|completed|finished|done|shipped|delivered)\b/i;
const TODAY_PATTERN =
  /\b(today|plan(ned)?|working on|focus|will you|going to|priorit)\b/i;
const BLOCKED_PATTERN = /\bblock(ed|er|ing|s)?\b/i;
const CONFIDENCE_PATTERN =
  /\b(confidence|scale|rating|1-5|1 to 5|how confident)\b/i;
const HELP_PATTERN = /\b(help|assistance|support|need.*from)\b/i;
const STATUS_PATTERN = /\b(status|progress|on track|task status)\b/i;

function classifyQuestionRole(
  questionText: string,
  questionType?: QuestionType,
): QuestionRole {
  if (questionType === QuestionType.BLOCKER) return 'blocked';
  const normalized = questionText.trim();
  if (BLOCKED_PATTERN.test(normalized)) return 'blocked';
  if (HELP_PATTERN.test(normalized)) return 'help';
  if (CONFIDENCE_PATTERN.test(normalized)) return 'confidence';
  if (STATUS_PATTERN.test(normalized)) return 'status';
  if (YESTERDAY_PATTERN.test(normalized)) return 'yesterday';
  if (TODAY_PATTERN.test(normalized)) return 'today';
  return 'other';
}

function pickAnswerText(
  answer: SubmissionInput['answers'][number],
): string {
  const displayText = formatAnswerForDisplay({
    text: answer.text,
    structuredValue: answer.structuredValue,
  });
  const enriched = enrichAnswerForAnalysis({
    questionText: answer.question.question,
    questionType: answer.question.type,
    text: displayText,
    structuredValue: answer.structuredValue,
  });
  return enriched.formattedAnswer?.trim() || displayText.trim();
}

function isBlockedAnswer(
  answer: SubmissionInput['answers'][number],
): boolean {
  if (
    classifyQuestionRole(answer.question.question, answer.question.type) !==
    'blocked'
  ) {
    return false;
  }

  const choice = parseYesNoChoice({
    type: answer.question.type,
    text: answer.text,
    structuredValue: answer.structuredValue,
  });

  if (choice === 'yes') return true;
  if (choice === 'no') return false;

  const sentiment = getSemanticSentiment({
    question: answer.question.question,
    type: answer.question.type,
    text: answer.text,
    structuredValue: answer.structuredValue,
  });
  return sentiment === 'negative';
}

function isHelpRequestedAnswer(
  answer: SubmissionInput['answers'][number],
): boolean {
  if (classifyQuestionRole(answer.question.question, answer.question.type) !== 'help') {
    return false;
  }

  const choice = parseYesNoChoice({
    type: answer.question.type,
    text: answer.text,
    structuredValue: answer.structuredValue,
  });

  if (choice === 'yes') return true;
  if (choice === 'no') return false;

  return getSemanticSentiment({
    question: answer.question.question,
    type: answer.question.type,
    text: answer.text,
    structuredValue: answer.structuredValue,
  }) === 'negative';
}

function parseConfidenceValue(
  answer: SubmissionInput['answers'][number],
): number | null {
  if (answer.question.type === QuestionType.SCALE_1_5) {
    const numeric = Number.parseFloat(answer.text);
    if (!Number.isNaN(numeric)) return numeric;
    const structured = (answer.structuredValue as { value?: number } | null)?.value;
    if (typeof structured === 'number') return structured;
  }

  if (answer.question.type === QuestionType.NUMERICAL) {
    const numeric = Number.parseFloat(answer.text);
    if (!Number.isNaN(numeric)) return numeric;
  }

  const match = answer.text.match(/\b([1-5])\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function buildParticipantProfiles(
  submissions: SubmissionInput[],
): ParticipantProfile[] {
  return submissions
    .filter(
      (submission) =>
        submission.status === 'completed' && submission.answers.length > 0,
    )
    .map((submission) => {
      const sorted = [...submission.answers].sort(
        (a, b) => (a.question.order ?? 0) - (b.question.order ?? 0),
      );

      let yesterdaysWork = '';
      let todaysPlan = '';
      let blockedDetail = '';
      let helpDetail = '';
      let confidence: number | null = null;
      let taskStatus = '';

      for (const answer of sorted) {
        const role = classifyQuestionRole(answer.question.question, answer.question.type);
        const text = pickAnswerText(answer);

        switch (role) {
          case 'yesterday':
            if (!yesterdaysWork && text) yesterdaysWork = text;
            break;
          case 'today':
            if (!todaysPlan && text) todaysPlan = text;
            break;
          case 'blocked': {
            const choice = parseYesNoChoice({
              type: answer.question.type,
              text: answer.text,
              structuredValue: answer.structuredValue,
            });
            // Explicit "No" means not blocked — do not treat the word "No" as blocker detail.
            if (choice === 'no') break;
            if (!blockedDetail && text) blockedDetail = text;
            break;
          }
          case 'help':
            if (!helpDetail && text) helpDetail = text;
            break;
          case 'confidence':
            confidence = parseConfidenceValue(answer) ?? confidence;
            break;
          case 'status':
            if (!taskStatus && text) taskStatus = text;
            break;
          case 'other':
            if (!yesterdaysWork && !TODAY_PATTERN.test(answer.question.question)) {
              yesterdaysWork = yesterdaysWork || text;
            } else if (!todaysPlan) {
              todaysPlan = todaysPlan || text;
            }
            break;
        }
      }

      const blockedRoleAnswer =
        sorted.find(
          (answer) =>
            classifyQuestionRole(answer.question.question, answer.question.type) ===
            'blocked',
        ) ?? null;
      const blocked = blockedRoleAnswer
        ? isBlockedAnswer(blockedRoleAnswer)
        : blockedDetail.length > 0;

      const helpRequested =
        isHelpRequestedAnswer(
          sorted.find(
            (answer) => classifyQuestionRole(answer.question.question, answer.question.type) === 'help',
          ) ?? sorted[0],
        ) || helpDetail.length > 0;

      if (!taskStatus) {
        if (blocked) {
          taskStatus = 'Blocked';
        } else if (helpRequested) {
          taskStatus = 'Needs help';
        } else if (yesterdaysWork || todaysPlan) {
          taskStatus = 'In progress';
        } else {
          taskStatus = 'Submitted';
        }
      }

      return {
        slackUserId: submission.user.slackUserId,
        displayName: submission.user.slackDisplayName,
        yesterdaysWork: yesterdaysWork || '—',
        todaysPlan: todaysPlan || '—',
        blocked,
        blockedDetail: blockedDetail || (blocked ? 'Reported a blocker' : ''),
        confidence,
        helpRequested,
        helpDetail: helpDetail || (helpRequested ? 'Requested help' : ''),
        taskStatus,
      };
    });
}

export function buildReportStatistics(
  submissions: SubmissionInput[],
  blockers: ExtractedBlocker[],
  profiles: ParticipantProfile[],
  completedCount: number,
  totalCount: number,
): ReportStatistics {
  const completedProfiles = profiles.filter(
    (profile) => profile.yesterdaysWork !== '—' || profile.todaysPlan !== '—',
  );

  const blockedMembersCount = profiles.filter((profile) => profile.blocked).length;
  const helpRequestedCount = profiles.filter(
    (profile) => profile.helpRequested,
  ).length;
  const atRiskCount = profiles.filter(
    (profile) =>
      profile.blocked ||
      profile.helpRequested ||
      (profile.confidence != null && profile.confidence <= 2),
  ).length;

  const confidenceValues = profiles
    .map((profile) => profile.confidence)
    .filter((value): value is number => value != null);

  const averageConfidence =
    confidenceValues.length > 0
      ? Math.round(
          (confidenceValues.reduce((sum, value) => sum + value, 0) /
            confidenceValues.length) *
            10,
        ) / 10
      : null;

  const completionRate =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const teamProgressBullets: string[] = [];

  const completedYesterday = profiles.filter(
    (profile) =>
      profile.yesterdaysWork !== '—' &&
      /\b(complet|finish|done|shipped|merged|delivered)\b/i.test(
        profile.yesterdaysWork,
      ),
  ).length;

  if (completedYesterday > 0) {
    teamProgressBullets.push(
      `${completedYesterday} member${completedYesterday === 1 ? '' : 's'} completed yesterday's tasks.`,
    );
  }

  const workingOn = profiles.filter((profile) => profile.todaysPlan !== '—');
  if (workingOn.length > 0) {
    teamProgressBullets.push(
      `${workingOn.length} member${workingOn.length === 1 ? '' : 's'} shared today's plan.`,
    );
  }

  if (blockedMembersCount > 0) {
    teamProgressBullets.push(
      `${blockedMembersCount} member${blockedMembersCount === 1 ? ' is' : 's are'} blocked.`,
    );
  }

  if (averageConfidence != null) {
    teamProgressBullets.push(
      `Average confidence: ${averageConfidence} / 5.`,
    );
  }

  teamProgressBullets.push(
    `Completion rate: ${completedCount}/${totalCount} (${completionRate}%).`,
  );

  return {
    completedTasksCount: completedYesterday,
    blockedMembersCount,
    helpRequestedCount,
    atRiskCount,
    averageConfidence,
    completionRate,
    teamProgressBullets,
    respondedCount: completedCount,
    totalParticipants: totalCount,
  };
}

export function groupBlockersByPerson(
  blockers: ExtractedBlocker[],
  userIdToName: Map<string, string>,
): NamedPersonSection[] {
  const grouped = new Map<string, string[]>();

  for (const blocker of blockers ?? []) {
    const userId = blocker?.userId?.trim() || '';
    const name = userId
      ? (userIdToName.get(userId) ??
        lookupSlackDisplayName(userId, userIdToName))
      : 'Unknown User';
    const description = blocker?.description?.trim() || 'Reported a blocker';
    const item = blocker?.dependency
      ? `${description} (${blocker.dependency})`
      : description;
    const existing = grouped.get(name) ?? [];
    existing.push(item);
    grouped.set(name, existing);
  }

  return [...grouped.entries()].map(([displayName, items]) => ({
    displayName,
    items,
  }));
}

export function isGenericReportPhrase(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;

  const genericPatterns = [
    /^team is progressing well\.?$/,
    /^some members\b/,
    /^the team\b/,
    /^participants\b/,
    /^several members\b/,
    /^multiple members\b/,
    /^there are blockers\.?$/,
    /^blockers were reported\.?$/,
    /^no additional insights\.?$/,
    /^no action items suggested\.?$/,
  ];

  return genericPatterns.some((pattern) => pattern.test(normalized));
}

export function filterGenericLines(lines: string[]): string[] {
  return lines.filter((line) => !isGenericReportPhrase(line));
}
