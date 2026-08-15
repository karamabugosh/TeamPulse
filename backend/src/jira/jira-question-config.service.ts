import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QuestionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type UpsertJiraQuestionConfigInput = {
  questionId: string;
  allowMultiple?: boolean;
  maxSelections?: number;
  allowedProjectKeys?: string[];
  plaintextFallbackEnabled?: boolean;
  actionProposalEnabled?: boolean;
};

@Injectable()
export class JiraQuestionConfigService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private readonly safeQuestionConfigSelect = {
    id: true,
    questionId: true,
    allowMultiple: true,
    maxSelections: true,
    allowedProjectKeys: true,
    plaintextFallbackEnabled: true,
    actionProposalEnabled: true,
    createdAt: true,
    updatedAt: true,
    question: {
      select: {
        id: true,
        checkInId: true,
        question: true,
        order: true,
        type: true,
        isRequired: true,
        isActive: true,
      },
    },
  } as const;

  async getQuestionConfig(
    questionIdInput: string,
  ) {
    const questionId =
      questionIdInput?.trim();

    if (!questionId) {
      throw new BadRequestException(
        'questionId is required.',
      );
    }

    const question =
      await this.prisma.question.findUnique({
        where: {
          id: questionId,
        },
        select: {
          id: true,
        },
      });

    if (!question) {
      throw new NotFoundException(
        `Question ${questionId} was not found.`,
      );
    }

    return this.prisma.jiraQuestionConfig.findUnique({
      where: {
        questionId,
      },
      select: this.safeQuestionConfigSelect,
    });
  }

  async upsertQuestionConfig(
    input: UpsertJiraQuestionConfigInput,
  ) {
    const questionId =
      input.questionId?.trim();

    if (!questionId) {
      throw new BadRequestException(
        'questionId is required.',
      );
    }

    const question =
      await this.prisma.question.findUnique({
        where: {
          id: questionId,
        },
        select: {
          id: true,
          type: true,
          checkIn: {
            select: {
              id: true,
              team: {
                select: {
                  id: true,
                  workspaceId: true,
                  jiraConfig: {
                    select: {
                      enabled: true,
                      issuePickerEnabled: true,
                      jiraIntegrationId: true,
                      commentProposalEnabled: true,
                      transitionProposalEnabled: true,
                      blockerProposalEnabled: true,
                      issueLinkProposalEnabled: true,
                      createIssueProposalEnabled: true,
                      jiraIntegration: {
                        select: {
                          id: true,
                          enabled: true,
                          allowedProjectKeys: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

    if (!question) {
      throw new NotFoundException(
        `Question ${questionId} was not found.`,
      );
    }

    if (
      question.type !== QuestionType.ISSUE_REF
    ) {
      throw new BadRequestException(
        'Jira question configuration is only allowed for ISSUE_REF questions.',
      );
    }

    if (!question.checkIn) {
      throw new BadRequestException(
        'The Jira question must belong to a Check-In.',
      );
    }

    const existingConfig =
      await this.prisma.jiraQuestionConfig.findUnique({
        where: {
          questionId,
        },
        select: {
          allowMultiple: true,
          maxSelections: true,
          allowedProjectKeys: true,
          plaintextFallbackEnabled: true,
          actionProposalEnabled: true,
        },
      });

    const effectiveAllowMultiple =
      input.allowMultiple ??
      existingConfig?.allowMultiple ??
      false;

    const maxSelectionsWasProvided =
      Object.prototype.hasOwnProperty.call(
        input,
        'maxSelections',
      );

    let effectiveMaxSelections: number;

    if (!effectiveAllowMultiple) {
      effectiveMaxSelections = 1;
    } else if (maxSelectionsWasProvided) {
      effectiveMaxSelections =
        input.maxSelections as number;
    } else if (
      existingConfig?.allowMultiple
    ) {
      effectiveMaxSelections =
        existingConfig.maxSelections;
    } else {
      effectiveMaxSelections = 5;
    }

    if (
      !Number.isInteger(
        effectiveMaxSelections,
      ) ||
      effectiveMaxSelections < 1 ||
      effectiveMaxSelections > 50
    ) {
      throw new BadRequestException(
        'maxSelections must be an integer between 1 and 50.',
      );
    }

    if (
      effectiveAllowMultiple &&
      effectiveMaxSelections < 2
    ) {
      throw new BadRequestException(
        'maxSelections must be at least 2 when multiple issue selection is enabled.',
      );
    }

    const allowedProjectsWereProvided =
      Object.prototype.hasOwnProperty.call(
        input,
        'allowedProjectKeys',
      );

    const effectiveAllowedProjectKeys =
      allowedProjectsWereProvided
        ? this.normalizeProjectKeys(
            input.allowedProjectKeys ?? [],
          )
        : existingConfig?.allowedProjectKeys ??
          [];

    const effectivePlaintextFallbackEnabled =
      input.plaintextFallbackEnabled ??
      existingConfig
        ?.plaintextFallbackEnabled ??
      true;

    const effectiveActionProposalEnabled =
      input.actionProposalEnabled ??
      existingConfig?.actionProposalEnabled ??
      false;

    const teamJiraConfig =
      question.checkIn.team.jiraConfig;

    const activeIssuePickerAvailable =
      Boolean(
        teamJiraConfig?.enabled &&
          teamJiraConfig.issuePickerEnabled &&
          teamJiraConfig.jiraIntegrationId &&
          teamJiraConfig.jiraIntegration
            ?.enabled,
      );

    if (
      !effectivePlaintextFallbackEnabled &&
      !activeIssuePickerAvailable
    ) {
      throw new BadRequestException(
        'Plain-text fallback cannot be disabled unless the team has an active Jira issue picker.',
      );
    }

    const integrationAllowedProjectKeys =
      teamJiraConfig?.jiraIntegration
        ?.allowedProjectKeys ?? [];

    if (
      integrationAllowedProjectKeys.length >
        0 &&
      effectiveAllowedProjectKeys.some(
        (projectKey) =>
          !integrationAllowedProjectKeys.includes(
            projectKey,
          ),
      )
    ) {
      throw new BadRequestException(
        'Every question project must be allowed by the selected Jira integration.',
      );
    }

    if (effectiveActionProposalEnabled) {
      if (
        !teamJiraConfig?.enabled ||
        !teamJiraConfig.jiraIntegrationId ||
        !teamJiraConfig.jiraIntegration
          ?.enabled
      ) {
        throw new BadRequestException(
          'AI action proposals require an active Jira integration for the team.',
        );
      }

      const atLeastOneProposalTypeEnabled =
        teamJiraConfig.commentProposalEnabled ||
        teamJiraConfig
          .transitionProposalEnabled ||
        teamJiraConfig.blockerProposalEnabled ||
        teamJiraConfig
          .issueLinkProposalEnabled ||
        teamJiraConfig
          .createIssueProposalEnabled;

      if (!atLeastOneProposalTypeEnabled) {
        throw new BadRequestException(
          'AI action proposals require at least one enabled proposal type for the team.',
        );
      }
    }

    return this.prisma.jiraQuestionConfig.upsert({
      where: {
        questionId,
      },
      update: {
        allowMultiple:
          effectiveAllowMultiple,
        maxSelections:
          effectiveMaxSelections,
        allowedProjectKeys:
          effectiveAllowedProjectKeys,
        plaintextFallbackEnabled:
          effectivePlaintextFallbackEnabled,
        actionProposalEnabled:
          effectiveActionProposalEnabled,
      },
      create: {
        questionId,
        allowMultiple:
          effectiveAllowMultiple,
        maxSelections:
          effectiveMaxSelections,
        allowedProjectKeys:
          effectiveAllowedProjectKeys,
        plaintextFallbackEnabled:
          effectivePlaintextFallbackEnabled,
        actionProposalEnabled:
          effectiveActionProposalEnabled,
      },
      select:
        this.safeQuestionConfigSelect,
    });
  }

  private normalizeProjectKeys(
    projectKeys: string[],
  ): string[] {
    if (!Array.isArray(projectKeys)) {
      throw new BadRequestException(
        'allowedProjectKeys must be an array.',
      );
    }

    return Array.from(
      new Set(
        projectKeys
          .map((projectKey) =>
            projectKey?.trim().toUpperCase(),
          )
          .filter(
            (projectKey): projectKey is string =>
              Boolean(projectKey),
          ),
      ),
    );
  }
}