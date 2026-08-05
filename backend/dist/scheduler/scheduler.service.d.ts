import { OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionService } from '../collection/collection.service';
import { DigestService } from '../digest/digest.service';
import { ReportsService } from '../reports/reports.service';
import { SlackService } from '../slack/slack.service';
type TeamDigestResult = {
    teamId: string | null;
    teamName: string;
    status: 'success' | 'partial_success' | 'failed' | 'skipped';
    responseCount: number;
    digest?: string;
    slackDelivered: boolean;
    slackError: string | null;
    generatedAt: string;
};
export declare class SchedulerService implements OnModuleInit {
    private readonly prisma;
    private readonly schedulerRegistry;
    private readonly collectionService;
    private readonly digestService;
    private readonly slackService;
    private readonly aiService;
    private readonly reportsService;
    private readonly logger;
    private readonly runningTeamIds;
    constructor(prisma: PrismaService, schedulerRegistry: SchedulerRegistry, collectionService: CollectionService, digestService: DigestService, slackService: SlackService, aiService: AiService, reportsService: ReportsService);
    onModuleInit(): Promise<void>;
    private registerTeamDigestJobs;
    runDailyDigest(): Promise<{
        status: string;
        generatedAt: string;
        mode?: undefined;
        results?: undefined;
        startedAt?: undefined;
        teamCount?: undefined;
    } | {
        status: "success" | "partial_success" | "failed" | "skipped";
        mode: string;
        results: TeamDigestResult[];
        startedAt: string;
        generatedAt: string;
        teamCount?: undefined;
    } | {
        status: string;
        mode: string;
        teamCount: number;
        results: TeamDigestResult[];
        startedAt: string;
        generatedAt: string;
    }>;
    runTeamDigest(teamId: string): Promise<TeamDigestResult>;
    private getOrGenerateAiDigest;
    private runEnvironmentFallbackDigest;
}
export {};
