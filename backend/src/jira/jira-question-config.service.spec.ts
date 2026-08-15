import * as assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { QuestionType } from '@prisma/client';
import {
  JiraQuestionConfigService,
  UpsertJiraQuestionConfigInput,
} from './jira-question-config.service';
import { PrismaService } from '../prisma/prisma.service';

type TeamJiraConfiguration = {
  enabled: boolean;
  issuePickerEnabled: boolean;
  jiraIntegrationId: string | null;
  commentProposalEnabled: boolean;
  transitionProposalEnabled: boolean;
  blockerProposalEnabled: boolean;
  issueLinkProposalEnabled: boolean;
  createIssueProposalEnabled: boolean;
  jiraIntegration: {
    id: string;
    enabled: boolean;
    allowedProjectKeys: string[];
  } | null;
};

type ExistingQuestionConfig = {
  allowMultiple: boolean;
  maxSelections: number;
  allowedProjectKeys: string[];
  plaintextFallbackEnabled: boolean;
  actionProposalEnabled: boolean;
};

type UpsertArguments = {
  where: {
    questionId: string;
  };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
  select: unknown;
};

describe('JiraQuestionConfigService', () => {
  let service: JiraQuestionConfigService;

  let questionType: QuestionType;
  let questionHasCheckIn: boolean;

  let teamJiraConfig:
    | TeamJiraConfiguration
    | null;

  let existingConfig:
    | ExistingQuestionConfig
    | null;

  let capturedUpsert:
    | UpsertArguments
    | undefined;

  beforeEach(() => {
    questionType = QuestionType.ISSUE_REF;
    questionHasCheckIn = true;
    existingConfig = null;
    capturedUpsert = undefined;

    teamJiraConfig = {
      enabled: true,
      issuePickerEnabled: true,
      jiraIntegrationId:
        'jira-integration-1',
      commentProposalEnabled: true,
      transitionProposalEnabled: true,
      blockerProposalEnabled: true,
      issueLinkProposalEnabled: true,
      createIssueProposalEnabled: false,
      jiraIntegration: {
        id: 'jira-integration-1',
        enabled: true,
        allowedProjectKeys: [
          'PULSE',
          'DEV',
        ],
      },
    };

    const prismaMock = {
      question: {
        findUnique: async () => ({
          id: 'question-1',
          type: questionType,
          checkIn: questionHasCheckIn
            ? {
                id: 'check-in-1',
                team: {
                  id: 'team-1',
                  workspaceId:
                    'workspace-1',
                  jiraConfig:
                    teamJiraConfig,
                },
              }
            : null,
        }),
      },

      jiraQuestionConfig: {
        findUnique: async () =>
          existingConfig,

        upsert: async (
          argumentsInput: UpsertArguments,
        ) => {
          capturedUpsert =
            argumentsInput;

          return {
            id: 'jira-question-config-1',
            ...argumentsInput.create,
            createdAt: new Date(
              '2026-08-15T00:00:00.000Z',
            ),
            updatedAt: new Date(
              '2026-08-15T00:00:00.000Z',
            ),
            question: {
              id: 'question-1',
              checkInId: 'check-in-1',
              question:
                'Which Jira issues are you working on?',
              order: 1,
              type:
                QuestionType.ISSUE_REF,
              isRequired: true,
              isActive: true,
            },
          };
        },
      },
    };

    service =
      new JiraQuestionConfigService(
        prismaMock as unknown as PrismaService,
      );
  });

  test('creates a multiple-issue question configuration with normalized projects', async () => {
    const input: UpsertJiraQuestionConfigInput = {
      questionId: ' question-1 ',
      allowMultiple: true,
      allowedProjectKeys: [
        'pulse',
        ' DEV ',
        'pulse',
      ],
      plaintextFallbackEnabled: false,
      actionProposalEnabled: true,
    };

    const result =
      await service.upsertQuestionConfig(
        input,
      );

    assert.equal(
      result.id,
      'jira-question-config-1',
    );

    assert.deepEqual(
      capturedUpsert?.create,
      {
        questionId: 'question-1',
        allowMultiple: true,
        maxSelections: 5,
        allowedProjectKeys: [
          'PULSE',
          'DEV',
        ],
        plaintextFallbackEnabled: false,
        actionProposalEnabled: true,
      },
    );
  });

  test('forces maxSelections to 1 for single selection', async () => {
    await service.upsertQuestionConfig({
      questionId: 'question-1',
      allowMultiple: false,
      maxSelections: 20,
    });

    assert.equal(
      capturedUpsert?.create.maxSelections,
      1,
    );
  });

  test('rejects Jira configuration for a non-ISSUE_REF question', async () => {
    questionType = QuestionType.FREE_TEXT;

    await assert.rejects(
      () =>
        service.upsertQuestionConfig({
          questionId: 'question-1',
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes(
          'only allowed for ISSUE_REF',
        ),
    );
  });

  test('rejects multiple selection with fewer than 2 choices', async () => {
    await assert.rejects(
      () =>
        service.upsertQuestionConfig({
          questionId: 'question-1',
          allowMultiple: true,
          maxSelections: 1,
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes(
          'at least 2',
        ),
    );
  });

  test('rejects disabling plain-text fallback when the issue picker is unavailable', async () => {
    if (teamJiraConfig) {
      teamJiraConfig.enabled = false;
    }

    await assert.rejects(
      () =>
        service.upsertQuestionConfig({
          questionId: 'question-1',
          plaintextFallbackEnabled: false,
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes(
          'Plain-text fallback cannot be disabled',
        ),
    );
  });

  test('rejects a question project outside the integration project scope', async () => {
    await assert.rejects(
      () =>
        service.upsertQuestionConfig({
          questionId: 'question-1',
          allowedProjectKeys: ['OPS'],
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes(
          'question project',
        ),
    );
  });

  test('rejects AI proposals without an active integration', async () => {
    if (teamJiraConfig) {
      teamJiraConfig.enabled = false;
    }

    await assert.rejects(
      () =>
        service.upsertQuestionConfig({
          questionId: 'question-1',
          actionProposalEnabled: true,
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes(
          'active Jira integration',
        ),
    );
  });

  test('rejects AI proposals when all team proposal types are disabled', async () => {
    if (teamJiraConfig) {
      teamJiraConfig.commentProposalEnabled =
        false;
      teamJiraConfig.transitionProposalEnabled =
        false;
      teamJiraConfig.blockerProposalEnabled =
        false;
      teamJiraConfig.issueLinkProposalEnabled =
        false;
      teamJiraConfig.createIssueProposalEnabled =
        false;
    }

    await assert.rejects(
      () =>
        service.upsertQuestionConfig({
          questionId: 'question-1',
          actionProposalEnabled: true,
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes(
          'at least one enabled proposal type',
        ),
    );
  });

  test('rejects a Jira question that is not attached to a Check-In', async () => {
    questionHasCheckIn = false;

    await assert.rejects(
      () =>
        service.upsertQuestionConfig({
          questionId: 'question-1',
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes(
          'must belong to a Check-In',
        ),
    );
  });

  test('preserves existing settings during a partial update', async () => {
    existingConfig = {
      allowMultiple: true,
      maxSelections: 7,
      allowedProjectKeys: ['DEV'],
      plaintextFallbackEnabled: true,
      actionProposalEnabled: false,
    };

    await service.upsertQuestionConfig({
      questionId: 'question-1',
    });

    assert.deepEqual(
      capturedUpsert?.update,
      {
        allowMultiple: true,
        maxSelections: 7,
        allowedProjectKeys: ['DEV'],
        plaintextFallbackEnabled: true,
        actionProposalEnabled: false,
      },
    );
  });
});