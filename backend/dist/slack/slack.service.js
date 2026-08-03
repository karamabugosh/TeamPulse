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
const prisma_service_1 = require("../prisma/prisma.service");
let SlackService = SlackService_1 = class SlackService {
    constructor(configService, prisma) {
        this.configService = configService;
        this.prisma = prisma;
        this.logger = new common_1.Logger(SlackService_1.name);
    }
    async onModuleInit() {
        await this.initializeSlack();
    }
    async onModuleDestroy() {
        if (this.app) {
            await this.app.stop();
        }
        this.logger.log('Slack service shutting down.');
    }
    async initializeSlack() {
        const token = this.configService.get('SLACK_BOT_TOKEN');
        const signingSecret = this.configService.get('SLACK_SIGNING_SECRET');
        const appToken = this.configService.get('SLACK_APP_TOKEN');
        if (!token || !signingSecret || !appToken) {
            this.logger.warn('Slack tokens are missing. Slack App will not be initialized.');
            return;
        }
        try {
            this.app = new bolt_1.App({
                token,
                signingSecret,
                appToken,
                socketMode: true,
            });
            await this.app.start();
            this.logger.log('⚡️ Slack Bolt app is running in Socket Mode!');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Error initializing Slack app: ${message}`, error instanceof Error ? error.stack : undefined);
        }
    }
    getSlackApp() {
        return this.app;
    }
    async ensureUserRegistered(slackUserId) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        if (!this.app) {
            throw new Error('Slack app is not initialized.');
        }
        const botToken = this.configService.get('SLACK_BOT_TOKEN');
        if (!botToken) {
            throw new Error('SLACK_BOT_TOKEN is not configured.');
        }
        const authResult = await this.app.client.auth.test();
        const slackWorkspaceId = authResult.team_id;
        const slackWorkspaceName = authResult.team;
        if (!slackWorkspaceId) {
            throw new Error('Slack API did not return a workspace ID.');
        }
        const workspace = await this.prisma.workspace.upsert({
            where: {
                slackWorkspaceId,
            },
            update: {
                slackWorkspaceName: slackWorkspaceName !== null && slackWorkspaceName !== void 0 ? slackWorkspaceName : 'Slack Workspace',
                botToken,
            },
            create: {
                slackWorkspaceId,
                slackWorkspaceName: slackWorkspaceName !== null && slackWorkspaceName !== void 0 ? slackWorkspaceName : 'Slack Workspace',
                botToken,
            },
        });
        const userResult = await this.app.client.users.info({
            user: slackUserId,
        });
        const slackUser = userResult.user;
        if (!(slackUser === null || slackUser === void 0 ? void 0 : slackUser.id)) {
            throw new Error(`Slack user ${slackUserId} could not be loaded.`);
        }
        const displayName = ((_a = slackUser.profile) === null || _a === void 0 ? void 0 : _a.display_name) ||
            ((_b = slackUser.profile) === null || _b === void 0 ? void 0 : _b.real_name) ||
            slackUser.name ||
            slackUser.id;
        const user = await this.prisma.user.upsert({
            where: {
                slackUserId: slackUser.id,
            },
            update: {
                workspaceId: workspace.id,
                slackDisplayName: displayName,
                email: (_d = (_c = slackUser.profile) === null || _c === void 0 ? void 0 : _c.email) !== null && _d !== void 0 ? _d : null,
                timezone: (_e = slackUser.tz) !== null && _e !== void 0 ? _e : null,
            },
            create: {
                workspaceId: workspace.id,
                slackUserId: slackUser.id,
                slackDisplayName: displayName,
                email: (_g = (_f = slackUser.profile) === null || _f === void 0 ? void 0 : _f.email) !== null && _g !== void 0 ? _g : null,
                timezone: (_h = slackUser.tz) !== null && _h !== void 0 ? _h : null,
            },
        });
        this.logger.log(`Slack user ${slackUserId} registered as database user ${user.id}`);
        return user.id;
    }
    async sendMessage(payload) {
        if (!this.app) {
            throw new Error('Cannot send message: Slack app is not initialized.');
        }
        if (!payload.channelId || !payload.text) {
            throw new Error('Cannot send message: channelId and text are required.');
        }
        const maxAttempts = 3;
        let delay = 1000;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                this.logger.log(`Sending message to channel ${payload.channelId} ` +
                    `(attempt ${attempt}/${maxAttempts})`);
                await this.app.client.chat.postMessage({
                    channel: payload.channelId,
                    text: payload.text,
                });
                return;
            }
            catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : 'Unknown Slack error';
                this.logger.error(`Failed to send Slack message: ${message}`);
                if (attempt === maxAttempts) {
                    throw error;
                }
                await new Promise((resolve) => {
                    setTimeout(resolve, delay);
                });
                delay *= 2;
            }
        }
    }
};
exports.SlackService = SlackService;
exports.SlackService = SlackService = SlackService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], SlackService);
//# sourceMappingURL=slack.service.js.map