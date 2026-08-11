import { QuestionType } from '@prisma/client';

export type CreateCheckInQuestionDto = {
  /*
   * Optional client-side reference for branching during creation.
   *
   * New questions do not yet have database IDs, so the create
   * flow can use a temporary reference like:
   *
   * ref: "blocked-question"
   *
   * and another question can depend on that reference.
   */
  ref?: string;

  question: string;
  order: number;

  type?: QuestionType;
  options?: string[];

  isRequired?: boolean;
  isActive?: boolean;

  /*
   * For create requests, this may reference:
   *
   * 1. An existing question database ID, or
   * 2. Another new question's `ref`
   *
   * CheckInService will resolve temporary refs before
   * persisting the final relationship.
   */
  dependsOnQuestionId?: string | null;

  /*
   * Canonical answer values that make this question eligible.
   *
   * Examples:
   *
   * YES_NO:
   * ["yes"]
   *
   * YES_NO_MAYBE:
   * ["yes", "maybe"]
   *
   * SCALE_1_5:
   * ["4", "5"]
   *
   * MULTIPLE_CHOICE:
   * ["Engineering", "Product"]
   */
  showWhenAnswers?: string[] | null;
};

export class CreateCheckInDto {
  teamId: string;

  name: string;

  description?: string;

  enabled?: boolean;

  timezone: string;

  collectionCron: string;

  reminderEnabled?: boolean;

  reminderMinutesAfter?: number;

  reportCron?: string;

  reportChannelId?: string;

  participantIds?: string[];

  questions?: CreateCheckInQuestionDto[];
}