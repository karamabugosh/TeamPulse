import { QuestionType } from '@prisma/client';

export type ReportTriggerMode = 'scheduled' | 'all_answered' | 'timeout';

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
  introMessage?: string;
  outroMessage?: string;

  enabled?: boolean;

  timezone: string;
  collectionCron: string;
  updatesChannelId?: string;

  reminderEnabled?: boolean;
  reminderMinutesAfter?: number;
  reminderRecurringEnabled?: boolean;
  reminderIntervalMinutes?: number;
  reminderOnlyNonResponders?: boolean;
  reminderOnSlackActive?: boolean;

  reportCron?: string;
  reportTriggerMode?: ReportTriggerMode;
  reportTimeoutMinutes?: number;

  publishStatus?: 'draft' | 'published';
  scheduleEnabled?: boolean;

  participantIds?: string[];

  questions?: CreateCheckInQuestionDto[];
}
