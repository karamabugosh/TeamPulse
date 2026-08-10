import { QuestionType } from '@prisma/client';

export type UpdateCheckInQuestionDto = {
  question: string;
  order: number;
  type?: QuestionType;
  options?: string[];
  isRequired?: boolean;
  isActive?: boolean;
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