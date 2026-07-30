import { PrismaService } from '../prisma/prisma.service';
import { CollectionGateway } from '../slack/interfaces/collection.gateway';
import { QuestionPayloadDto } from '../slack/dto/question-payload.dto';
import { StandupResponse } from '../common/types/standup-response.type';
export type AppHomeSummary = {
    activeQuestionCount: number;
    status: 'not_started' | 'in_progress' | 'completed';
    lastCompletedAt: Date | null;
};
export declare class CollectionService implements CollectionGateway {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    getAppHomeSummary(userId: string): Promise<AppHomeSummary>;
    startConversation(userId: string): Promise<QuestionPayloadDto | null>;
    submitAnswer(userId: string, questionId: string, answer: string): Promise<void>;
    getNextQuestion(userId: string): Promise<QuestionPayloadDto | null>;
    finishConversation(userId: string): Promise<void>;
    getCurrentQuestion(userId: string): Promise<QuestionPayloadDto | null>;
    getCompletedStandupResponses(): Promise<StandupResponse[]>;
}
