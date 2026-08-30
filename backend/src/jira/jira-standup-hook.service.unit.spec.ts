import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { QuestionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JiraBlockerService } from './jira-blocker.service';
import { JiraCacheService } from './jira-cache.service';
import { JiraIssueRefService } from './jira-issue-ref.service';
import { JiraIssueSnapshot } from './jira-issue-ref.types';
import { JiraStandupHookService } from './jira-standup-hook.service';
import { JiraService } from './jira.service';

jest.mock('./jira-issue-payload.util', () => ({
  extractBlockerDetailsFromAnswer: jest.fn(),
}));

import {
  extractBlockerDetailsFromAnswer,
  ExtractedBlockerDetails,
} from './jira-issue-payload.util';

const extractBlockerDetailsMock = jest.mocked(extractBlockerDetailsFromAnswer);

function blockerDetails(
  overrides: Partial<ExtractedBlockerDetails> = {},
): ExtractedBlockerDetails {
  return {
    title: 'Blocker',
    description: 'Details',
    severity: 'medium',
    category: null,
    expectedResolution: null,
    preventingAllWork: false,
    ownerLabel: null,
    canContinueOtherTask: null,
    jiraIssue: null,
    ...overrides,
  };
}

describe('JiraStandupHookService', () => {
  let service: JiraStandupHookService;
  let prisma: {
    user: {
      findUnique: jest.MockedFunction<(args: unknown) => Promise<unknown>>;
    };
    standupSubmission: {
      findUnique: jest.MockedFunction<(args: unknown) => Promise<unknown>>;
    };
  };
  let jiraService: {
    resolveUserIdFromSlack: jest.MockedFunction<
      (slackUserId: string) => Promise<string | null>
    >;
    hasUserConnection: jest.MockedFunction<
      (userId: string) => Promise<boolean>
    >;
    hasJiraForSlackUser: jest.MockedFunction<
      (slackUserId: string) => Promise<boolean>
    >;
    getConnectionStatus: jest.MockedFunction<
      () => Promise<{ connected: boolean }>
    >;
  };
  let jiraCacheService: {
    refreshUserCache: jest.MockedFunction<
      (userId: string) => Promise<number>
    >;
  };
  let jiraIssueRefService: {
    readSnapshotFromStructuredValue: jest.MockedFunction<
      (structuredValue: unknown) => JiraIssueSnapshot | null
    >;
  };
  let jiraBlockerService: {
    createFromAnswer: jest.MockedFunction<(args: unknown) => Promise<{ id: string }>>;
    proposeJiraActionForBlocker: jest.MockedFunction<
      (args: unknown) => Promise<{
        actionId: string;
        actionType: string;
        jiraIssueKey?: string | null;
      } | null>
    >;
  };

  const snapshot: JiraIssueSnapshot = {
    type: 'issue_ref',
    issueKey: 'SCRUM-1',
    issueId: '10001',
    summary: 'Fix login',
    status: 'In Progress',
    projectKey: 'SCRUM',
    projectName: 'Scrum',
    issueType: 'Bug',
    priority: 'High',
    issueUrl: 'https://jira.example/SCRUM-1',
    capturedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    prisma = {
      user: {
        findUnique: jest.fn<(args: unknown) => Promise<unknown>>(),
      },
      standupSubmission: {
        findUnique: jest.fn<(args: unknown) => Promise<unknown>>(),
      },
    };
    jiraService = {
      resolveUserIdFromSlack: jest.fn<
        (slackUserId: string) => Promise<string | null>
      >(),
      hasUserConnection: jest.fn<(userId: string) => Promise<boolean>>(),
      hasJiraForSlackUser: jest.fn<
        (slackUserId: string) => Promise<boolean>
      >(),
      getConnectionStatus: jest.fn<
        () => Promise<{ connected: boolean }>
      >(),
    };
    jiraCacheService = {
      refreshUserCache: jest.fn<(userId: string) => Promise<number>>(),
    };
    jiraIssueRefService = {
      readSnapshotFromStructuredValue: jest.fn<
        (structuredValue: unknown) => JiraIssueSnapshot | null
      >(),
    };
    jiraBlockerService = {
      createFromAnswer: jest.fn<(args: unknown) => Promise<{ id: string }>>(),
      proposeJiraActionForBlocker: jest.fn<
        (args: unknown) => Promise<{
          actionId: string;
          actionType: string;
          jiraIssueKey?: string | null;
        } | null>
      >(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JiraStandupHookService,
        { provide: PrismaService, useValue: prisma },
        { provide: JiraService, useValue: jiraService },
        { provide: JiraCacheService, useValue: jiraCacheService },
        { provide: JiraIssueRefService, useValue: jiraIssueRefService },
        { provide: JiraBlockerService, useValue: jiraBlockerService },
      ],
    }).compile();

    service = module.get(JiraStandupHookService);
  });

  describe('shouldRenderIssuePicker', () => {
    it('returns false when question type is not ISSUE_REF', async () => {
      await expect(
        service.shouldRenderIssuePicker('U1', QuestionType.FREE_TEXT),
      ).resolves.toBe(false);
      expect(jiraService.resolveUserIdFromSlack).not.toHaveBeenCalled();
    });

    it('returns false when slack user cannot be resolved', async () => {
      jiraService.resolveUserIdFromSlack.mockResolvedValue(null);

      await expect(
        service.shouldRenderIssuePicker('U1', QuestionType.ISSUE_REF),
      ).resolves.toBe(false);
    });

    it('returns true when user has a Jira connection', async () => {
      jiraService.resolveUserIdFromSlack.mockResolvedValue('user-1');
      jiraService.hasUserConnection.mockResolvedValue(true);

      await expect(
        service.shouldRenderIssuePicker('U1', QuestionType.ISSUE_REF),
      ).resolves.toBe(true);
    });

    it('returns false when user has no Jira connection', async () => {
      jiraService.resolveUserIdFromSlack.mockResolvedValue('user-1');
      jiraService.hasUserConnection.mockResolvedValue(false);

      await expect(
        service.shouldRenderIssuePicker('U1', QuestionType.ISSUE_REF),
      ).resolves.toBe(false);
    });

    it('returns false when Jira lookup throws', async () => {
      jiraService.resolveUserIdFromSlack.mockRejectedValue(new Error('boom'));

      await expect(
        service.shouldRenderIssuePicker('U1', QuestionType.ISSUE_REF),
      ).resolves.toBe(false);
    });
  });

  describe('shouldShowJiraLinkPicker', () => {
    it('returns true when slack user has Jira linked', async () => {
      jiraService.hasJiraForSlackUser.mockResolvedValue(true);

      await expect(service.shouldShowJiraLinkPicker('U1')).resolves.toBe(true);
    });

    it('returns false when lookup throws synchronously', async () => {
      jiraService.hasJiraForSlackUser.mockImplementation(() => {
        throw new Error('fail');
      });

      await expect(service.shouldShowJiraLinkPicker('U1')).resolves.toBe(false);
    });
  });

  describe('isWorkspaceJiraConnected', () => {
    it('returns true when workspace Jira is connected', async () => {
      jiraService.getConnectionStatus.mockResolvedValue({ connected: true });

      await expect(service.isWorkspaceJiraConnected()).resolves.toBe(true);
    });

    it('returns false when workspace Jira is disconnected', async () => {
      jiraService.getConnectionStatus.mockResolvedValue({ connected: false });

      await expect(service.isWorkspaceJiraConnected()).resolves.toBe(false);
    });

    it('returns false when status lookup throws', async () => {
      jiraService.getConnectionStatus.mockRejectedValue(new Error('fail'));

      await expect(service.isWorkspaceJiraConnected()).resolves.toBe(false);
    });
  });

  describe('prepareQuestionForDelivery', () => {
    it('returns the question unchanged for non ISSUE_REF types', async () => {
      const question = {
        type: QuestionType.FREE_TEXT,
        questionId: 'q1',
        text: 'What did you do?',
      };

      await expect(
        service.prepareQuestionForDelivery({
          slackUserId: 'U1',
          question,
        }),
      ).resolves.toEqual(question);
    });

    it('downgrades ISSUE_REF to FREE_TEXT when picker cannot render', async () => {
      jiraService.resolveUserIdFromSlack.mockResolvedValue(null);

      const question = {
        type: QuestionType.ISSUE_REF,
        questionId: 'q1',
        text: 'Link an issue',
      };

      await expect(
        service.prepareQuestionForDelivery({
          slackUserId: 'U1',
          question,
        }),
      ).resolves.toEqual({
        ...question,
        type: QuestionType.FREE_TEXT,
      });
    });

    it('refreshes user cache when ISSUE_REF picker is available', async () => {
      jiraService.resolveUserIdFromSlack.mockResolvedValue('user-1');
      jiraService.hasUserConnection.mockResolvedValue(true);
      jiraCacheService.refreshUserCache.mockResolvedValue(3);

      const question = {
        type: QuestionType.ISSUE_REF,
        questionId: 'q1',
        text: 'Link an issue',
      };

      await expect(
        service.prepareQuestionForDelivery({
          slackUserId: 'U1',
          question,
        }),
      ).resolves.toEqual(question);
      expect(jiraCacheService.refreshUserCache).toHaveBeenCalledWith('user-1');
    });

    it('ignores cache refresh failures when ISSUE_REF picker is available', async () => {
      jiraService.resolveUserIdFromSlack.mockResolvedValue('user-1');
      jiraService.hasUserConnection.mockResolvedValue(true);
      jiraCacheService.refreshUserCache.mockRejectedValue(new Error('cache fail'));

      const question = {
        type: QuestionType.ISSUE_REF,
        questionId: 'q1',
        text: 'Link an issue',
      };

      await expect(
        service.prepareQuestionForDelivery({
          slackUserId: 'U1',
          question,
        }),
      ).resolves.toEqual(question);
    });

    it('skips cache refresh when slack user cannot be resolved for ISSUE_REF picker', async () => {
      jiraService.resolveUserIdFromSlack
        .mockResolvedValueOnce('user-1')
        .mockResolvedValueOnce(null);
      jiraService.hasUserConnection.mockResolvedValue(true);

      const question = {
        type: QuestionType.ISSUE_REF,
        questionId: 'q1',
        text: 'Link an issue',
      };

      await expect(
        service.prepareQuestionForDelivery({
          slackUserId: 'U1',
          question,
        }),
      ).resolves.toEqual(question);
      expect(jiraCacheService.refreshUserCache).not.toHaveBeenCalled();
    });
  });

  describe('afterSubmissionCompleted', () => {
    const baseParams = {
      submissionId: 'sub-1',
      slackUserId: 'U1',
      channelId: 'C1',
      threadTs: '123.456',
      onProposal: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    it('returns early when slack user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service.afterSubmissionCompleted(baseParams);

      expect(prisma.standupSubmission.findUnique).not.toHaveBeenCalled();
    });

    it('returns early when submission is not found', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.standupSubmission.findUnique.mockResolvedValue(null);

      await service.afterSubmissionCompleted(baseParams);

      expect(jiraBlockerService.createFromAnswer).not.toHaveBeenCalled();
    });

    it('skips answers without modal blocker structured value', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.standupSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        runId: 'run-1',
        answers: [
          {
            id: 'ans-1',
            text: 'Blocked',
            structuredValue: { blocked: false },
            question: { type: QuestionType.YES_NO },
          },
        ],
        run: { teamId: 'team-1', checkInId: 'ci-1' },
      });

      await service.afterSubmissionCompleted(baseParams);

      expect(jiraBlockerService.createFromAnswer).not.toHaveBeenCalled();
    });

    it('skips answers when blocker object is missing from structured value', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.standupSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        runId: 'run-1',
        answers: [
          {
            id: 'ans-1',
            text: 'Blocked',
            structuredValue: { blocked: true },
            question: { type: QuestionType.YES_NO },
          },
        ],
        run: { teamId: 'team-1', checkInId: 'ci-1' },
      });

      await service.afterSubmissionCompleted(baseParams);

      expect(extractBlockerDetailsMock).not.toHaveBeenCalled();
    });

    it('skips answers when blocker field is not an object', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.standupSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        runId: 'run-1',
        answers: [
          {
            id: 'ans-1',
            text: 'Blocked',
            structuredValue: { blocked: true, blocker: 'not-an-object' },
            question: { type: QuestionType.YES_NO },
          },
        ],
        run: { teamId: 'team-1', checkInId: 'ci-1' },
      });

      await service.afterSubmissionCompleted(baseParams);

      expect(extractBlockerDetailsMock).not.toHaveBeenCalled();
    });

    it('processes blocker when only title is provided', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.standupSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        runId: 'run-1',
        answers: [
          {
            id: 'ans-1',
            text: 'Blocked',
            structuredValue: {
              blocked: true,
              blocker: { title: 'Deploy' },
            },
            question: { type: QuestionType.YES_NO },
          },
        ],
        run: { teamId: 'team-1', checkInId: 'ci-1' },
      });
      extractBlockerDetailsMock.mockReturnValue(
        blockerDetails({ title: 'Deploy', description: '' }),
      );
      jiraIssueRefService.readSnapshotFromStructuredValue.mockReturnValue(null);
      jiraBlockerService.createFromAnswer.mockResolvedValue({ id: 'blocker-1' });
      jiraService.hasUserConnection.mockResolvedValue(false);

      await service.afterSubmissionCompleted(baseParams);

      expect(jiraBlockerService.createFromAnswer).toHaveBeenCalled();
    });

    it('skips answers when blocker details are empty', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.standupSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        runId: 'run-1',
        answers: [
          {
            id: 'ans-1',
            text: 'Blocked',
            structuredValue: {
              blocked: true,
              blocker: { title: '', description: '' },
            },
            question: { type: QuestionType.YES_NO },
          },
        ],
        run: { teamId: 'team-1', checkInId: 'ci-1' },
      });
      extractBlockerDetailsMock.mockReturnValue(
        blockerDetails({ title: '', description: '' }),
      );

      await service.afterSubmissionCompleted(baseParams);

      expect(jiraBlockerService.createFromAnswer).not.toHaveBeenCalled();
    });

    it('uses linked issue key from snapshot when jiraIssue is absent', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.standupSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        runId: 'run-1',
        answers: [
          {
            id: 'ans-1',
            text: 'Blocked',
            structuredValue: {
              blocked: true,
              blocker: { title: 'API', description: 'Down' },
            },
            question: { type: QuestionType.YES_NO },
          },
        ],
        run: { teamId: 'team-1', checkInId: 'ci-1' },
      });
      extractBlockerDetailsMock.mockReturnValue(
        blockerDetails({
          title: 'API',
          description: 'Down',
          jiraIssue: null,
        }),
      );
      jiraIssueRefService.readSnapshotFromStructuredValue.mockReturnValue(snapshot);
      jiraBlockerService.createFromAnswer.mockResolvedValue({ id: 'blocker-1' });
      jiraService.hasUserConnection.mockResolvedValue(false);

      await service.afterSubmissionCompleted(baseParams);

      expect(jiraBlockerService.createFromAnswer).toHaveBeenCalledWith(
        expect.objectContaining({
          linkedIssueKey: 'SCRUM-1',
        }),
      );
    });

    it('processes blocker when only description is provided', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.standupSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        runId: 'run-1',
        answers: [
          {
            id: 'ans-1',
            text: 'Blocked',
            structuredValue: {
              blocked: true,
              blocker: { description: 'Cannot deploy' },
            },
            question: { type: QuestionType.YES_NO },
          },
        ],
        run: { teamId: 'team-1', checkInId: 'ci-1' },
      });
      extractBlockerDetailsMock.mockReturnValue(
        blockerDetails({ title: '', description: 'Cannot deploy' }),
      );
      jiraIssueRefService.readSnapshotFromStructuredValue.mockReturnValue(null);
      jiraBlockerService.createFromAnswer.mockResolvedValue({ id: 'blocker-1' });
      jiraService.hasUserConnection.mockResolvedValue(false);

      await service.afterSubmissionCompleted(baseParams);

      expect(jiraBlockerService.createFromAnswer).toHaveBeenCalled();
    });

    it('skips answers when structured value is null', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.standupSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        runId: 'run-1',
        answers: [
          {
            id: 'ans-1',
            text: 'Blocked',
            structuredValue: null,
            question: { type: QuestionType.YES_NO },
          },
        ],
        run: { teamId: 'team-1', checkInId: 'ci-1' },
      });

      await service.afterSubmissionCompleted(baseParams);

      expect(extractBlockerDetailsMock).not.toHaveBeenCalled();
    });

    it('creates blocker but skips proposal when user has no Jira connection', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.standupSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        runId: 'run-1',
        answers: [
          {
            id: 'ans-1',
            text: 'Blocked on deploy',
            structuredValue: {
              blocked: true,
              blocker: { title: 'Deploy', description: 'Cannot deploy' },
            },
            question: { type: QuestionType.YES_NO },
          },
        ],
        run: { teamId: 'team-1', checkInId: 'ci-1' },
      });
      extractBlockerDetailsMock.mockReturnValue(
        blockerDetails({
          title: 'Deploy',
          description: 'Cannot deploy',
          category: 'infra',
          severity: 'high',
          expectedResolution: 'tomorrow',
          preventingAllWork: true,
          ownerLabel: 'Ops',
          jiraIssue: 'SCRUM-9',
        }),
      );
      jiraIssueRefService.readSnapshotFromStructuredValue.mockReturnValue(snapshot);
      jiraBlockerService.createFromAnswer.mockResolvedValue({ id: 'blocker-1' });
      jiraService.hasUserConnection.mockResolvedValue(false);

      await service.afterSubmissionCompleted(baseParams);

      expect(jiraBlockerService.createFromAnswer).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          linkedIssueKey: 'SCRUM-9',
          linkedIssueId: '10001',
          linkedIssueUrl: snapshot.issueUrl,
        }),
      );
      expect(jiraBlockerService.proposeJiraActionForBlocker).not.toHaveBeenCalled();
      expect(baseParams.onProposal).not.toHaveBeenCalled();
    });

    it('emits add_comment proposal when Jira is connected', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.standupSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        runId: 'run-1',
        answers: [
          {
            id: 'ans-1',
            text: 'Blocked on deploy',
            structuredValue: {
              blocked: true,
              blocker: { title: 'Deploy', description: 'Cannot deploy' },
            },
            question: { type: QuestionType.YES_NO },
          },
        ],
        run: { teamId: 'team-1', checkInId: 'ci-1' },
      });
      extractBlockerDetailsMock.mockReturnValue(
        blockerDetails({
          title: 'Deploy',
          description: 'Cannot deploy',
          category: 'infra',
          severity: 'high',
          expectedResolution: 'tomorrow',
          preventingAllWork: true,
          ownerLabel: 'Ops',
        }),
      );
      jiraIssueRefService.readSnapshotFromStructuredValue.mockReturnValue(null);
      jiraBlockerService.createFromAnswer.mockResolvedValue({ id: 'blocker-1' });
      jiraService.hasUserConnection.mockResolvedValue(true);
      jiraBlockerService.proposeJiraActionForBlocker.mockResolvedValue({
        actionId: 'act-1',
        actionType: 'add_comment',
        jiraIssueKey: 'SCRUM-2',
      });

      await service.afterSubmissionCompleted(baseParams);

      expect(baseParams.onProposal).toHaveBeenCalledWith({
        actionId: 'act-1',
        actionType: 'add_comment',
        issueKey: 'SCRUM-2',
        summaryText: 'Add blocker comment to SCRUM-2',
      });
    });

    it('emits create issue proposal when action type is not add_comment', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.standupSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        runId: 'run-1',
        answers: [
          {
            id: 'ans-1',
            text: 'Blocked',
            structuredValue: {
              blocked: true,
              blocker: { title: 'API', description: 'Down' },
            },
            question: { type: QuestionType.YES_NO },
          },
        ],
        run: { teamId: 'team-1', checkInId: 'ci-1' },
      });
      extractBlockerDetailsMock.mockReturnValue(
        blockerDetails({
          title: 'API',
          description: 'Down',
        }),
      );
      jiraIssueRefService.readSnapshotFromStructuredValue.mockReturnValue(null);
      jiraBlockerService.createFromAnswer.mockResolvedValue({ id: 'blocker-1' });
      jiraService.hasUserConnection.mockResolvedValue(true);
      jiraBlockerService.proposeJiraActionForBlocker.mockResolvedValue({
        actionId: 'act-2',
        actionType: 'create_issue',
        jiraIssueKey: null,
      });

      await service.afterSubmissionCompleted(baseParams);

      expect(baseParams.onProposal).toHaveBeenCalledWith({
        actionId: 'act-2',
        actionType: 'create_issue',
        issueKey: null,
        summaryText: 'Create Jira issue from blocker',
      });
    });

    it('uses fallback issue label when add_comment proposal has no issue key', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.standupSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        runId: 'run-1',
        answers: [
          {
            id: 'ans-1',
            text: 'Blocked',
            structuredValue: {
              blocked: true,
              blocker: { title: 'API', description: 'Down' },
            },
            question: { type: QuestionType.YES_NO },
          },
        ],
        run: { teamId: 'team-1', checkInId: 'ci-1' },
      });
      extractBlockerDetailsMock.mockReturnValue(
        blockerDetails({
          title: 'API',
          description: 'Down',
        }),
      );
      jiraIssueRefService.readSnapshotFromStructuredValue.mockReturnValue(null);
      jiraBlockerService.createFromAnswer.mockResolvedValue({ id: 'blocker-1' });
      jiraService.hasUserConnection.mockResolvedValue(true);
      jiraBlockerService.proposeJiraActionForBlocker.mockResolvedValue({
        actionId: 'act-3',
        actionType: 'add_comment',
        jiraIssueKey: null,
      });

      await service.afterSubmissionCompleted(baseParams);

      expect(baseParams.onProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          summaryText: 'Add blocker comment to issue',
        }),
      );
    });

    it('skips proposal callback when blocker service returns no proposal', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.standupSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        runId: 'run-1',
        answers: [
          {
            id: 'ans-1',
            text: 'Blocked',
            structuredValue: {
              blocked: true,
              blocker: { title: 'API', description: 'Down' },
            },
            question: { type: QuestionType.YES_NO },
          },
        ],
        run: { teamId: 'team-1', checkInId: 'ci-1' },
      });
      extractBlockerDetailsMock.mockReturnValue(
        blockerDetails({
          title: 'API',
          description: 'Down',
        }),
      );
      jiraIssueRefService.readSnapshotFromStructuredValue.mockReturnValue(null);
      jiraBlockerService.createFromAnswer.mockResolvedValue({ id: 'blocker-1' });
      jiraService.hasUserConnection.mockResolvedValue(true);
      jiraBlockerService.proposeJiraActionForBlocker.mockResolvedValue(null);

      await service.afterSubmissionCompleted(baseParams);

      expect(baseParams.onProposal).not.toHaveBeenCalled();
    });

    it('logs and swallows errors without failing standup completion', async () => {
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      prisma.user.findUnique.mockRejectedValue(new Error('db down'));

      await expect(
        service.afterSubmissionCompleted(baseParams),
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        'Post-submission Jira hook failed: db down',
      );

      warnSpy.mockRestore();
    });

    it('logs non-Error failures with String conversion', async () => {
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      prisma.user.findUnique.mockRejectedValue('plain failure');

      await service.afterSubmissionCompleted(baseParams);

      expect(warnSpy).toHaveBeenCalledWith(
        'Post-submission Jira hook failed: plain failure',
      );

      warnSpy.mockRestore();
    });
  });

  describe('formatAnswerForDigest', () => {
    it('formats issue ref snapshots for digest display', () => {
      jiraIssueRefService.readSnapshotFromStructuredValue.mockReturnValue(snapshot);

      expect(
        service.formatAnswerForDigest({
          text: 'fallback text',
          structuredValue: { type: 'issue_ref' },
        }),
      ).toBe('SCRUM-1 · Fix login · In Progress');
    });

    it('returns raw answer text when no issue snapshot exists', () => {
      jiraIssueRefService.readSnapshotFromStructuredValue.mockReturnValue(null);

      expect(
        service.formatAnswerForDigest({
          text: 'Working on auth',
          structuredValue: null,
        }),
      ).toBe('Working on auth');
    });
  });
});
