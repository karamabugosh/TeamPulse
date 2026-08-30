import { QuestionType } from '@prisma/client';
import { ReportTriggerMode } from './create-check-in.dto';

export type UpdateCheckInQuestionDto = {
  id?: string;
  question: string;
  order: number;
  type?: QuestionType;
  options?: string[];
  isRequired?: boolean;
  isActive?: boolean;
};

export class UpdateCheckInDto {
  /** When set, CheckIn moves to this team (must belong to the active workspace). */
  teamId?: string;

  name?: string;
  description?: string | null;
  introMessage?: string | null;
  outroMessage?: string | null;

  enabled?: boolean;

  timezone?: string;
  collectionCron?: string;
  updatesChannelId?: string | null;

  reminderEnabled?: boolean;
  reminderMinutesAfter?: number;
  reminderRecurringEnabled?: boolean;
  reminderIntervalMinutes?: number | null;
  reminderOnlyNonResponders?: boolean;
  reminderOnSlackActive?: boolean;

  reportCron?: string | null;
  reportTriggerMode?: ReportTriggerMode;
  reportTimeoutMinutes?: number | null;

  publishStatus?: 'draft' | 'published';
  scheduleEnabled?: boolean;

  participantIds?: string[];

  questions?: UpdateCheckInQuestionDto[];
}
