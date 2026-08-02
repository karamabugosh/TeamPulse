import { QuestionPayloadDto } from '../dto/question-payload.dto';
export interface CollectionGateway {
    startConversation(userId: string): Promise<QuestionPayloadDto | null>;
    submitAnswer(userId: string, questionId: string, answer: string): Promise<void>;
    getNextQuestion(userId: string): Promise<QuestionPayloadDto | null>;
    finishConversation(userId: string): Promise<void>;
    getCurrentQuestion(userId: string): Promise<QuestionPayloadDto | null>;
}
