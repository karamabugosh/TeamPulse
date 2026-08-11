import { QuestionType } from '@prisma/client';

export type UpdateCheckInQuestionDto = {
  /*
   * Existing question ID.
   *
   * This becomes important for branching because one question
   * may reference another question by ID.
   *
   * New questions may omit this field.
   */
  id?: string;

  question: string;
  order: number;

  type?: QuestionType;
  options?: string[];

  isRequired?: boolean;
  isActive?: boolean;

  /*
   * Optional branching rule.
   *
   * Example:
   *
   * Question:
   * "Describe the blocker"
   *
   * dependsOnQuestionId:
   * ID of "Are you currently blocked?"
   *
   * showWhenAnswers:
   * ["yes"]
   *
   * If dependsOnQuestionId is null/undefined, the question
   * behaves like a normal always-visible question.
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

export class UpdateCheckInDto {
  name?: string;

  description?: string | null;

  enabled?: boolean;

  timezone?: string;

  collectionCron?: string;

  reminderEnabled?: boolean;

  reminderMinutesAfter?: number;

  reportCron?: string | null;

  reportChannelId?: string | null;

  participantIds?: string[];

  questions?: UpdateCheckInQuestionDto[];
}