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
var SlackService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlackService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bolt_1 = require("@slack/bolt");
let SlackService = SlackService_1 = class SlackService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(SlackService_1.name);
    }
    async onModuleInit() {
        this.initializeSlack();
    }
    async onModuleDestroy() {
        this.logger.log('Slack service shutting down.');
    }
    initializeSlack() {
        const token = this.configService.get('SLACK_BOT_TOKEN');
        const signingSecret = this.configService.get('SLACK_SIGNING_SECRET');
        const appToken = this.configService.get('SLACK_APP_TOKEN');
        if (!token || !signingSecret || !appToken) {
            this.logger.warn('Slack tokens are missing from environment variables. Slack App will not be initialized.');
            return;
        }
        try {
            this.app = new bolt_1.App({
                token,
                signingSecret,
                appToken,
                socketMode: true,
            });
            this.app.start().then(() => {
                this.logger.log('⚡️ Slack Bolt app is running in Socket Mode!');
            }).catch(err => {
                this.logger.error('Failed to start Slack Bolt app', err);
            });
        }
        catch (error) {
            this.logger.error(`Error initializing Slack app: ${error.message}`, error.stack);
        }
    }
    getSlackApp() {
        return this.app;
    }
    async sendMessage(payload) {
        if (!this.app) {
            this.logger.error('Cannot send message: Slack app is not initialized.');
            return;
        }
        if (!payload.channelId || !payload.text) {
            this.logger.error('Cannot send message: Missing channelId or text.');
            return;
        }
        let retries = 3;
        let delay = 1000;
        while (retries > 0) {
            try {
                this.logger.log(`Sending message to channel: ${payload.channelId} (Retries left: ${retries - 1})`);
                await this.app.client.chat.postMessage({
                    channel: payload.channelId,
                    text: payload.text,
                });
                return;
            }
            catch (error) {
                this.logger.error(`Failed to send Slack message to ${payload.channelId}: ${error.message}`);
                retries--;
                if (retries === 0) {
                    this.logger.error(`Exhausted retries for sending message to ${payload.channelId}.`);
                }
                else {
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                }
            }
        }
    }
};
exports.SlackService = SlackService;
exports.SlackService = SlackService = SlackService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SlackService);
//# sourceMappingURL=slack.service.js.map