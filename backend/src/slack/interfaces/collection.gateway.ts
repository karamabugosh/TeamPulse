import { QuestionPayloadDto } from '../dto/question-payload.dto';

/**
 * TODO: Member 1 Integration
 * This interface defines the contract for communicating with the Collection module.
 * Member 1 will provide the implementation for these methods.
 */
export interface CollectionGateway {
  /**
   * Starts a conversation and returns the first question, if any.
   */
  startConversation(userId: string): Promise<QuestionPayloadDto | null>;

  /**
   * Submits an answer for a specific question.
   * Returns the next unanswered question, or null when the CheckIn is complete.
   */
  submitAnswer(userId: string, questionId: string, answer: string): Promise<QuestionPayloadDto | null>;

  /**
   * Retrieves the next question in the sequence for the user.
   */
  getNextQuestion(userId: string): Promise<QuestionPayloadDto | null>;

  /**
   * Concludes the conversation.
   */
  finishConversation(userId: string): Promise<string | null>;

  /**
   * Finalizes the active conversation and returns submission metadata.
   */
  completeConversation(
    userId: string,
  ): Promise<{
    submissionId: string;
    checkInName: string | null;
    runId: string;
  } | null>;

  /**
   * Returns the question the user should answer now, if any.
   */
  getCurrentQuestion(userId: string): Promise<QuestionPayloadDto | null>;
}
