import { Injectable, Logger } from '@nestjs/common';
import { QuestionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatIssueRefDisplay } from './jira-issue-ref.types';
import { extractBlockerDetailsFromAnswer } from './jira-issue-payload.util';
import { JiraBlockerService } from './jira-blocker.service';
import { JiraCacheService } from './jira-cache.service';
import { JiraIssueRefService } from './jira-issue-ref.service';
import { JiraService } from './jira.service';

@Injectable()
export class JiraStandupHookService {
  private readonly logger = new Logger(JiraStandupHookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraService: JiraService,
    private readonly jiraCacheService: JiraCacheService,
    private readonly jiraIssueRefService: JiraIssueRefService,
    private readonly jiraBlockerService: JiraBlockerService,
  ) {}

  async shouldRenderIssuePicker(
    slackUserId: string,
    questionType?: QuestionType,
  ): Promise<boolean> {
    if (questionType !== QuestionType.ISSUE_REF) {
      return false;
    }

    try {
      const userId = await this.jiraService.resolveUserIdFromSlack(slackUserId);
      if (!userId) {
        return false;
      }
      return this.jiraService.hasUserConnection(userId);
    } catch {
      return false;
    }
  }

  async shouldShowJiraLinkPicker(slackUserId: string): Promise<boolean> {
    try {
      return this.jiraService.hasJiraForSlackUser(slackUserId);
    } catch {
      return false;
    }
  }

  async isWorkspaceJiraConnected(): Promise<boolean> {
    try {
      const status = await this.jiraService.getConnectionStatus();
      return status.connected;
    } catch {
      return false;
    }
  }

  async prepareQuestionForDelivery(params: {
    slackUserId: string;
    question: { type?: QuestionType; questionId: string; text: string };
  }) {
    const usePicker = await this.shouldRenderIssuePicker(
      params.slackUserId,
      params.question.type,
    );

    if (params.question.type === QuestionType.ISSUE_REF && !usePicker) {
      return {
        ...params.question,
        type: QuestionType.FREE_TEXT,
      };
    }

    if (params.question.type === QuestionType.ISSUE_REF && usePicker) {
      const userId = await this.jiraService.resolveUserIdFromSlack(
        params.slackUserId,
      );
      if (userId) {
        await this.jiraCacheService.refreshUserCache(userId).catch(() => 0);
      }
    }

    return params.question;
  }

  async afterSubmissionCompleted(params: {
    submissionId: string;
    slackUserId: string;
    channelId: string;
    threadTs: string;
    onProposal: (proposal: {
      actionId: string;
      actionType: string;
      issueKey?: string | null;
      summaryText: string;
    }) => Promise<void>;
  }): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { slackUserId: params.slackUserId },
      });
      if (!user) {
        return;
      }

      const submission = await this.prisma.standupSubmission.findUnique({
        where: { id: params.submissionId },
        include: {
          answers: { include: { question: true } },
          run: { include: { checkIn: true, team: true } },
        },
      });

      if (!submission) {
        return;
      }

      for (const answer of submission.answers) {
        const structured = answer.structuredValue as
          | { blocked?: boolean; blocker?: Record<string, unknown>; value?: boolean }
          | null;

        // Blockers are created only from the Blocker Details modal
        // (BLOCKER / legacy phrase YES_NO → Yes → modal → structuredValue.blocker).
        const hasModalBlocker =
          structured?.blocked === true &&
          structured.blocker &&
          typeof structured.blocker === 'object';

        if (!hasModalBlocker) {
          continue;
        }

        const details = extractBlockerDetailsFromAnswer({
          text: answer.text,
          structuredValue: answer.structuredValue,
        });

        if (!details.title.trim() && !details.description.trim()) {
          continue;
        }

        const linkedSnapshot =
          this.jiraIssueRefService.readSnapshotFromStructuredValue(
            answer.structuredValue,
          );

        const blocker = await this.jiraBlockerService.createFromAnswer({
          userId: user.id,
          teamId: submission.run.teamId,
          checkInId: submission.run.checkInId,
          runId: submission.runId,
          submissionId: submission.id,
          answerId: answer.id,
          title: details.title,
          description: details.description,
          category: details.category,
          severity: details.severity,
          expectedResolution: details.expectedResolution,
          preventingAllWork: details.preventingAllWork,
          ownerLabel: details.ownerLabel,
          linkedIssueKey: details.jiraIssue ?? linkedSnapshot?.issueKey ?? null,
          linkedIssueId: linkedSnapshot?.issueId ?? null,
          linkedIssueUrl: linkedSnapshot?.issueUrl ?? null,
        });

        const hasJira = await this.jiraService.hasUserConnection(user.id);
        if (!hasJira) {
          continue;
        }

        const proposal =
          await this.jiraBlockerService.proposeJiraActionForBlocker({
            blockerId: blocker.id,
            userId: user.id,
            slackChannelId: params.channelId,
            slackMessageTs: params.threadTs,
            summary: details.title,
            description: details.description,
          });

        if (!proposal) {
          continue;
        }

        const summaryText =
          proposal.actionType === 'add_comment'
            ? `Add blocker comment to ${proposal.jiraIssueKey ?? 'issue'}`
            : 'Create Jira issue from blocker';

        await params.onProposal({
          actionId: proposal.actionId,
          actionType: proposal.actionType,
          issueKey: proposal.jiraIssueKey,
          summaryText,
        });
      }
    } catch (error: unknown) {
      // Never fail standup completion because of Jira.
      this.logger.warn(
        `Post-submission Jira hook failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  formatAnswerForDigest(answer: {
    text: string;
    structuredValue: unknown;
  }): string {
    const snapshot = this.jiraIssueRefService.readSnapshotFromStructuredValue(
      answer.structuredValue,
    );
    if (snapshot) {
      return formatIssueRefDisplay(snapshot);
    }
    return answer.text;
  }
}
