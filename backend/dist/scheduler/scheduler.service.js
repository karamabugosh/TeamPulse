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
const schedule_1 = require("@nestjs/schedule");
const collection_service_1 = require("../collection/collection.service");
const digest_service_1 = require("../digest/digest.service");
const slack_service_1 = require("../slack/slack.service");
let SchedulerService = SchedulerService_1 = class SchedulerService {
    constructor(collectionService, digestService, slackService) {
        this.collectionService = collectionService;
        this.digestService = digestService;
        this.slackService = slackService;
        this.logger = new common_1.Logger(SchedulerService_1.name);
    }
    async runDailyDigest() {
        if (process.env.DIGEST_SCHEDULER_ENABLED !== 'true') {
            this.logger.warn('Daily digest scheduler is disabled');
            return {
                status: 'disabled',
                generatedAt: new Date().toISOString(),
            };
        }
        const responses = await this.collectionService.getCompletedStandupResponses();
        const digest = this.digestService.generateDailyDigest(responses);
        let slackDelivered = false;
        let slackError = null;
        if (process.env.SLACK_DIGEST_ENABLED === 'true') {
            const channelId = process.env.SLACK_DIGEST_CHANNEL_ID;
            if (!channelId) {
                slackError = 'SLACK_DIGEST_CHANNEL_ID is missing';
                this.logger.error(`Digest generated, but Slack delivery failed: ${slackError}`);
            }
            else {
                try {
                    await this.slackService.sendMessage({
                        channelId,
                        text: digest,
                    });
                    slackDelivered = true;
                    this.logger.log('Scheduled digest posted to Slack');
                }
                catch (error) {
                    slackError =
                        error instanceof Error ? error.message : String(error);
                    this.logger.error(`Digest generated, but Slack delivery failed: ${slackError}`);
                }
            }
        }
        else {
            this.logger.log('Scheduled digest generated without Slack delivery');
        }
        return {
            status: 'success',
            responseCount: responses.length,
            digest,
            slackDelivered,
            slackError,
            generatedAt: new Date().toISOString(),
        };
    }
};
exports.SchedulerService = SchedulerService;
__decorate([
    (0, schedule_1.Cron)(process.env.DAILY_DIGEST_CRON || '0 0 9 * * 0-4', {
        name: 'daily-digest',
        timeZone: process.env.DAILY_DIGEST_TIMEZONE || 'Asia/Riyadh',
        waitForCompletion: true,
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SchedulerService.prototype, "runDailyDigest", null);
exports.SchedulerService = SchedulerService = SchedulerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [collection_service_1.CollectionService,
        digest_service_1.DigestService,
        slack_service_1.SlackService])
], SchedulerService);
//# sourceMappingURL=scheduler.service.js.map