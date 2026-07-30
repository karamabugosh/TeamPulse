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
        await this.initializeSlack();
    }
    async onModuleDestroy() {
        if (this.app) {
            await this.app.stop();
        }
        this.logger.log('Slack service shut down.');
    }
    async initializeSlack() {
        const socketModeEnabled = this.configService.get('SLACK_SOCKET_MODE_ENABLED') ===
            'true';
        if (!socketModeEnabled) {
            this.logger.warn('Slack Socket Mode is disabled. Skipping Slack connection.');
            return;
        }
        const token = this.configService.get('SLACK_BOT_TOKEN');
        const signingSecret = this.configService.get('SLACK_SIGNING_SECRET');
        const appToken = this.configService.get('SLACK_APP_TOKEN');
        if (!token || !signingSecret || !appToken) {
            this.logger.warn('Slack credentials are missing. Slack App will not be initialized.');
            return;
        }
        this.app = new bolt_1.App({
            token,
            signingSecret,
            appToken,
            socketMode: true,
        });
        try {
            await this.app.start();
            this.logger.log('Slack Bolt app is running in Socket Mode');
        }
        catch (error) {
            this.app = undefined;
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to start Slack Bolt app: ${message}`);
        }
    }
    getSlackApp() {
        return this.app;
    }
    async sendMessage(payload) {
        if (!this.app) {
            throw new Error('Slack app is not initialized. Enable SLACK_SOCKET_MODE_ENABLED and provide valid Slack credentials.');
        }
        if (!payload.channelId || !payload.text) {
            throw new Error('Missing Slack channelId or text');
        }
        let retries = 3;
        let delay = 1000;
        while (retries > 0) {
            try {
                await this.app.client.chat.postMessage({
                    channel: payload.channelId,
                    text: payload.text,
                });
                this.logger.log(`Message sent to Slack channel ${payload.channelId}`);
                return;
            }
            catch (error) {
                retries--;
                const message = error instanceof Error ? error.message : String(error);
                this.logger.error(`Failed to send Slack message to ${payload.channelId}: ${message}`);
                if (retries === 0) {
                    throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay *= 2;
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