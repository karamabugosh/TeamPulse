"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SchedulerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerService = void 0;
const common_1 = require("@nestjs/common");
const cron_1 = require("cron");
const schedule_1 = require("@nestjs/schedule");
const ai_service_1 = require("../ai/ai.service");
const prisma_service_1 = require("../prisma/prisma.service");
const collection_service_1 = require("../collection/collection.service");
const digest_service_1 = require("../digest/digest.service");
const reports_service_1 = require("../reports/reports.service");
const slack_service_1 = require("../slack/slack.service");
let SchedulerService = SchedulerService_1 = class SchedulerService {
    constructor(prisma, schedulerRegistry, collectionService, digestService, slackService, aiService, reportsService) {
        this.prisma = prisma;
        this.schedulerRegistry = schedulerRegistry;
        this.collectionService = collectionService;
        this.digestService = digestService;
        this.slackService = slackService;
        this.aiService = aiService;
        this.reportsService = reportsService;
        this.logger = new common_1.Logger(SchedulerService_1.name);
        this.runningTeamIds = new Set();
    }
    async onModuleInit() {
        if (process.env.DIGEST_SCHEDULER_ENABLED !== 'true') {
            this.logger.warn('Database-driven digest scheduling is disabled.');
            return;
        }
        await this.registerTeamDigestJobs();
    }
    async registerTeamDigestJobs() {
        var _a, _b;
        const teams = await this.prisma.team.findMany({
            where: {
                schedulerEnabled: true,
                scheduleCron: {
                    not: null,
                },
                slackChannelId: {
                    not: null,
                },
            },
            orderBy: {
                createdAt: 'asc',
            },
        });
        if (teams.length === 0) {
            this.logger.warn('No enabled teams with a schedule and Slack channel were found.');
            return;
        }
        for (const team of teams) {
            const scheduleCron = (_a = team.scheduleCron) === null || _a === void 0 ? void 0 : _a.trim();
            const timezone = ((_b = team.timezone) === null || _b === void 0 ? void 0 : _b.trim()) ||
                process.env.DAILY_DIGEST_TIMEZONE ||
                'Asia/Riyadh';
            if (!scheduleCron) {
                this.logger.warn(`Team "${team.name}" does not have a valid cron schedule.`);
                continue;
            }
            const jobName = `daily-digest-${team.id}`;
            try {
                if (this.schedulerRegistry.doesExist('cron', jobName)) {
                    this.schedulerRegistry.deleteCronJob(jobName);
                }
                const job = cron_1.CronJob.from({
                    cronTime: scheduleCron,
                    timeZone: timezone,
                    waitForCompletion: true,
                    onTick: async () => {
                        await this.runTeamDigest(team.id);
                    },
                    errorHandler: (error) => {
                        const message = error instanceof Error
                            ? error.message
                            : String(error);
                        this.logger.error(`Scheduled digest job failed for team "${team.name}": ${message}`);
                    },
                });
                this.schedulerRegistry.addCronJob(jobName, job);
                job.start();
                this.logger.log(`Registered digest schedule for team "${team.name}" using "${scheduleCron}" in ${timezone}.`);
            }
            catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : String(error);
                this.logger.error(`Could not register digest schedule for team "${team.name}": ${message}`);
            }
        }
    }
    async runDailyDigest() {
        const startedAt = new Date();
        if (process.env.DIGEST_SCHEDULER_ENABLED !== 'true') {
            this.logger.warn('Daily digest scheduler is disabled.');
            return {
                status: 'disabled',
                generatedAt: startedAt.toISOString(),
            };
        }
        const teams = await this.prisma.team.findMany({
            where: {
                schedulerEnabled: true,
            },
            orderBy: {
                createdAt: 'asc',
            },
        });
        if (teams.length === 0) {
            const fallbackResult = await this.runEnvironmentFallbackDigest();
            return {
                status: fallbackResult.status,
                mode: 'environment-fallback',
                results: [fallbackResult],
                startedAt: startedAt.toISOString(),
                generatedAt: new Date().toISOString(),
            };
        }
        const results = [];
        for (const team of teams) {
            const result = await this.runTeamDigest(team.id);
            results.push(result);
        }
        const failedCount = results.filter((result) => result.status === 'failed').length;
        const partialCount = results.filter((result) => result.status === 'partial_success').length;
        return {
            status: failedCount > 0 || partialCount > 0
                ? 'partial_success'
                : 'success',
            mode: 'database-teams',
            teamCount: teams.length,
            results,
            startedAt: startedAt.toISOString(),
            generatedAt: new Date().toISOString(),
        };
    }
    async runTeamDigest(teamId) {
        var _a;
        const startedAt = new Date();
        if (this.runningTeamIds.has(teamId)) {
            this.logger.warn(`Digest generation is already running for team ${teamId}. Duplicate run skipped.`);
            return {
                teamId,
                teamName: teamId,
                status: 'skipped',
                responseCount: 0,
                slackDelivered: false,
                slackError: 'A digest run is already in progress for this team.',
                generatedAt: startedAt.toISOString(),
            };
        }
        this.runningTeamIds.add(teamId);
        try {
            const team = await this.prisma.team.findUnique({
                where: {
                    id: teamId,
                },
            });
            if (!team) {
                throw new Error(`Team ${teamId} was not found.`);
            }
            if (!team.schedulerEnabled) {
                return {
                    teamId: team.id,
                    teamName: team.name,
                    status: 'skipped',
                    responseCount: 0,
                    slackDelivered: false,
                    slackError: 'Team scheduling is disabled.',
                    generatedAt: new Date().toISOString(),
                };
            }
            const responses = await this.collectionService.getCompletedStandupResponses(team.id);
            const nonResponders = await this.collectionService.getTeamNonResponders(team.id, responses);
            let digest = this.digestService.generateDailyDigest(responses, nonResponders);
            if (responses.length > 0) {
                try {
                    const latestCompletedRun = await this.prisma.standupRun.findFirst({
                        where: {
                            teamId: team.id,
                            status: 'completed',
                        },
                        orderBy: [
                            {
                                completedAt: 'desc',
                            },
                            {
                                createdAt: 'desc',
                            },
                        ],
                        include: {
                            submissions: {
                                where: {
                                    status: 'completed',
                                },
                                include: {
                                    user: true,
                                    answers: {
                                        include: {
                                            question: true,
                                        },
                                        orderBy: {
                                            createdAt: 'asc',
                                        },
                                    },
                                },
                            },
                        },
                    });
                    if (!latestCompletedRun) {
                        this.logger.warn(`No completed StandupRun was found for team "${team.name}". Using the rules-based digest.`);
                    }
                    else {
                        const aiResponses = latestCompletedRun.submissions
                            .filter((submission) => submission.answers.length > 0)
                            .map((submission) => ({
                            userId: submission.user.slackUserId,
                            answers: submission.answers.map((answer) => ({
                                questionId: answer.questionId,
                                questionText: answer.question.question,
                                text: answer.text,
                            })),
                        }));
                        if (aiResponses.length === 0) {
                            this.logger.warn(`Completed run ${latestCompletedRun.id} has no answers for AI analysis. Using the rules-based digest.`);
                        }
                        else {
                            const aiResult = await this.getOrGenerateAiDigest(team.id, latestCompletedRun.id, aiResponses);
                            digest =
                                this.reportsService.formatDigestForSlack(aiResult);
                            const nonResponderSection = nonResponders.length > 0
                                ? [
                                    '*⏳ No Response*',
                                    ...nonResponders.map((member) => `• ${member.name}`),
                                ].join('\n')
                                : '*⏳ No Response*\n• Everyone submitted.';
                            digest =
                                `${digest}\n\n${nonResponderSection}`;
                            this.logger.log(`AI digest prepared for team "${team.name}" using standup run ${latestCompletedRun.id}.`);
                        }
                    }
                }
                catch (error) {
                    const message = error instanceof Error
                        ? error.message
                        : String(error);
                    this.logger.error(`AI digest generation failed for team "${team.name}". Using the rules-based digest instead: ${message}`, error instanceof Error
                        ? error.stack
                        : undefined);
                }
            }
            const channelId = (_a = team.slackChannelId) === null || _a === void 0 ? void 0 : _a.trim();
            if (!channelId) {
                return {
                    teamId: team.id,
                    teamName: team.name,
                    status: 'partial_success',
                    responseCount: responses.length,
                    digest,
                    slackDelivered: false,
                    slackError: 'The team does not have a Slack channel configured.',
                    generatedAt: new Date().toISOString(),
                };
            }
            if (responses.length === 0 &&
                process.env.SEND_EMPTY_DIGEST !== 'true') {
                this.logger.warn(`No completed responses were found for team "${team.name}". Empty digest not posted.`);
                return {
                    teamId: team.id,
                    teamName: team.name,
                    status: 'skipped',
                    responseCount: 0,
                    digest,
                    slackDelivered: false,
                    slackError: 'No completed responses were found.',
                    generatedAt: new Date().toISOString(),
                };
            }
            if (process.env.SLACK_DIGEST_ENABLED !== 'true') {
                return {
                    teamId: team.id,
                    teamName: team.name,
                    status: 'partial_success',
                    responseCount: responses.length,
                    digest,
                    slackDelivered: false,
                    slackError: 'SLACK_DIGEST_ENABLED is not true.',
                    generatedAt: new Date().toISOString(),
                };
            }
            const slackDelivered = await this.slackService.sendMessage({
                channelId,
                text: digest,
            });
            const completedAt = new Date();
            if (!slackDelivered) {
                return {
                    teamId: team.id,
                    teamName: team.name,
                    status: 'partial_success',
                    responseCount: responses.length,
                    digest,
                    slackDelivered: false,
                    slackError: 'SlackService could not deliver the digest.',
                    generatedAt: completedAt.toISOString(),
                };
            }
            this.logger.log(`Digest for team "${team.name}" posted to Slack with ${responses.length} response(s) and ${nonResponders.length} non-responder(s) in ${completedAt.getTime() - startedAt.getTime()}ms.`);
            return {
                teamId: team.id,
                teamName: team.name,
                status: 'success',
                responseCount: responses.length,
                digest,
                slackDelivered: true,
                slackError: null,
                generatedAt: completedAt.toISOString(),
            };
        }
        catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);
            this.logger.error(`Team digest generation failed for team ${teamId}: ${message}`, error instanceof Error
                ? error.stack
                : undefined);
            return {
                teamId,
                teamName: teamId,
                status: 'failed',
                responseCount: 0,
                slackDelivered: false,
                slackError: message,
                generatedAt: new Date().toISOString(),
            };
        }
        finally {
            this.runningTeamIds.delete(teamId);
        }
    }
    async getOrGenerateAiDigest(teamId, runId, responses) {
        const existingDigest = await this.prisma.aiDigest.findFirst({
            where: {
                teamId,
                runId,
            },
            orderBy: {
                generatedAt: 'desc',
            },
        });
        if (existingDigest) {
            this.logger.log(`Using existing AI digest for standup run ${runId}.`);
            return {
                teamId: existingDigest.teamId,
                runId: existingDigest.runId,
                generatedAt: existingDigest.generatedAt.toISOString(),
                source: existingDigest.source === 'rules_fallback'
                    ? 'rules_fallback'
                    : 'ai',
                summary: existingDigest.summary,
                blockers: existingDigest.blockers,
                themes: existingDigest.themes,
            };
        }
        return this.aiService.analyzeRun(teamId, runId, responses);
    }
    async runEnvironmentFallbackDigest() {
        var _a;
        const responses = await this.collectionService.getCompletedStandupResponses();
        const digest = this.digestService.generateDailyDigest(responses);
        const channelId = (_a = process.env.SLACK_DIGEST_CHANNEL_ID) === null || _a === void 0 ? void 0 : _a.trim();
        if (!channelId) {
            return {
                teamId: null,
                teamName: 'Environment fallback',
                status: 'partial_success',
                responseCount: responses.length,
                digest,
                slackDelivered: false,
                slackError: 'SLACK_DIGEST_CHANNEL_ID is missing.',
                generatedAt: new Date().toISOString(),
            };
        }
        if (responses.length === 0 &&
            process.env.SEND_EMPTY_DIGEST !== 'true') {
            return {
                teamId: null,
                teamName: 'Environment fallback',
                status: 'skipped',
                responseCount: 0,
                digest,
                slackDelivered: false,
                slackError: 'No completed responses were found.',
                generatedAt: new Date().toISOString(),
            };
        }
        if (process.env.SLACK_DIGEST_ENABLED !== 'true') {
            return {
                teamId: null,
                teamName: 'Environment fallback',
                status: 'partial_success',
                responseCount: responses.length,
                digest,
                slackDelivered: false,
                slackError: 'SLACK_DIGEST_ENABLED is not true.',
                generatedAt: new Date().toISOString(),
            };
        }
        const slackDelivered = await this.slackService.sendMessage({
            channelId,
            text: digest,
        });
        return {
            teamId: null,
            teamName: 'Environment fallback',
            status: slackDelivered
                ? 'success'
                : 'partial_success',
            responseCount: responses.length,
            digest,
            slackDelivered,
            slackError: slackDelivered
                ? null
                : 'SlackService could not deliver the digest.',
            generatedAt: new Date().toISOString(),
        };
    }
};
exports.SchedulerService = SchedulerService;
exports.SchedulerService = SchedulerService = SchedulerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        schedule_1.SchedulerRegistry,
        collection_service_1.CollectionService,
        digest_service_1.DigestService,
        slack_service_1.SlackService,
        ai_service_1.AiService,
        reports_service_1.ReportsService])
], SchedulerService);
//# sourceMappingURL=scheduler.service.js.map