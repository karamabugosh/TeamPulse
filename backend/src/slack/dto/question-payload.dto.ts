import { QuestionType } from '@prisma/client';

export class QuestionPayloadDto {
  questionId: string;
  text: string;

  type?: QuestionType;
  options?: string[];

  questionNumber?: number;
  totalQuestions?: number;
}