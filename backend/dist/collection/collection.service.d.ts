import { StandupNonResponder, StandupResponse } from '../common/types/standup-response.type';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionPayloadDto } from '../slack/dto/question-payload.dto';
import { CollectionGateway } from '../slack/interfaces/collection.gateway';
export type AppHomeSummary = {
    activeQuestionCount: number;
    status: 'not_started' | 'in_progress' | 'completed';
    lastCompletedAt: Date | null;
};
export declare class CollectionService implements CollectionGateway {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    private getOrCreateUser;
    private getUserTeam;
    private createStandupSubmission;
    syncSlackUserProfile(slackUserId: string, slackDisplayName: string): Promise<void>;
    getAppHomeSummary(userIdentifier: string): Promise<AppHomeSummary>;
    startConversation(userIdentifier: string): Promise<QuestionPayloadDto | null>;
    submitAnswer(userIdentifier: string, questionId: string, answer: string): Promise<void>;
    getNextQuestion(userIdentifier: string): Promise<QuestionPayloadDto | null>;
    finishConversation(userIdentifier: string): Promise<void>;
    getCurrentQuestion(userIdentifier: string): Promise<QuestionPayloadDto | null>;
    getCompletedStandupResponses(teamId?: string): Promise<StandupResponse[]>;
    private getLegacyCompletedResponses;
    getTeamNonResponders(teamId: string, completedResponses: StandupResponse[]): Promise<StandupNonResponder[]>;
}
