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
        this.logger.log('Slack service shutting down.');
        if (this.app) {
            await this.app.stop();
        }
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
            const message = error instanceof Error
                ? error.message
                : String(error);
            this.logger.error(`Error initializing Slack app: ${message}`, error instanceof Error
                ? error.stack
                : undefined);
        }
    }
    getSlackApp() {
        return this.app;
    }
    async ensureUserRegistered(slackUserId) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
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
        const displayName = ((_b = (_a = slackUser.profile) === null || _a === void 0 ? void 0 : _a.display_name) === null || _b === void 0 ? void 0 : _b.trim()) ||
            ((_d = (_c = slackUser.profile) === null || _c === void 0 ? void 0 : _c.real_name) === null || _d === void 0 ? void 0 : _d.trim()) ||
            ((_e = slackUser.real_name) === null || _e === void 0 ? void 0 : _e.trim()) ||
            ((_f = slackUser.name) === null || _f === void 0 ? void 0 : _f.trim()) ||
            slackUser.id;
        const user = await this.prisma.user.upsert({
            where: {
                slackUserId: slackUser.id,
            },
            update: {
                workspaceId: workspace.id,
                slackDisplayName: displayName,
                email: (_h = (_g = slackUser.profile) === null || _g === void 0 ? void 0 : _g.email) !== null && _h !== void 0 ? _h : null,
                timezone: (_j = slackUser.tz) !== null && _j !== void 0 ? _j : null,
            },
            create: {
                workspaceId: workspace.id,
                slackUserId: slackUser.id,
                slackDisplayName: displayName,
                email: (_l = (_k = slackUser.profile) === null || _k === void 0 ? void 0 : _k.email) !== null && _l !== void 0 ? _l : null,
                timezone: (_m = slackUser.tz) !== null && _m !== void 0 ? _m : null,
            },
        });
        this.logger.log(`Slack user ${slackUserId} registered as database user ${user.id}`);
        return user.id;
    }
    async getUserDisplayName(slackUserId) {
        var _a, _b, _c, _d, _e, _f;
        if (!slackUserId) {
            return 'Unknown user';
        }
        if (!this.app) {
            this.logger.warn(`Cannot look up Slack user ${slackUserId}: Slack app is not initialized.`);
            return slackUserId;
        }
        try {
            const result = await this.app.client.users.info({
                user: slackUserId,
            });
            const member = result.user;
            return (((_b = (_a = member === null || member === void 0 ? void 0 : member.profile) === null || _a === void 0 ? void 0 : _a.display_name) === null || _b === void 0 ? void 0 : _b.trim()) ||
                ((_d = (_c = member === null || member === void 0 ? void 0 : member.profile) === null || _c === void 0 ? void 0 : _c.real_name) === null || _d === void 0 ? void 0 : _d.trim()) ||
                ((_e = member === null || member === void 0 ? void 0 : member.real_name) === null || _e === void 0 ? void 0 : _e.trim()) ||
                ((_f = member === null || member === void 0 ? void 0 : member.name) === null || _f === void 0 ? void 0 : _f.trim()) ||
                slackUserId);
        }
        catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);
            this.logger.warn(`Could not retrieve the display name for Slack user ${slackUserId}: ${message}`);
            return slackUserId;
        }
    }
    async sendMessage(payload) {
        if (!this.app) {
            this.logger.error('Cannot send message: Slack app is not initialized.');
            return false;
        }
        if (!payload.channelId || !payload.text) {
            this.logger.error('Cannot send message: channelId and text are required.');
            return false;
        }
        const maxAttempts = 3;
        let delay = 1000;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                this.logger.log(`Sending message to channel ${payload.channelId} ` +
                    `(attempt ${attempt}/${maxAttempts})`);
                await this.app.client.chat.postMessage({
                    channel: payload.channelId,
                    text: payload.text,
                });
                this.logger.log(`Slack message delivered successfully to ${payload.channelId}.`);
                return true;
            }
            catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : String(error);
                this.logger.error(`Failed to send Slack message to ${payload.channelId}: ${message}`);
                if (attempt === maxAttempts) {
                    this.logger.error(`Exhausted retries for Slack channel ${payload.channelId}.`);
                    return false;
                }
                await new Promise((resolve) => {
                    setTimeout(resolve, delay);
                });
                delay *= 2;
            }
        }
        return false;
    }
};
exports.SlackService = SlackService;
exports.SlackService = SlackService = SlackService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], SlackService);
//# sourceMappingURL=slack.service.js.map