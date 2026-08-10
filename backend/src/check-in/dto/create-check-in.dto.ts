import { QuestionType } from '@prisma/client';

export type CreateCheckInQuestionDto = {
  question: string;
  order: number;
  type?: QuestionType;
  options?: string[];
  isRequired?: boolean;
  isActive?: boolean;
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