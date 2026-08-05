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
var SlackListener_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlackListener = void 0;
const common_1 = require("@nestjs/common");
const collection_service_1 = require("../collection/collection.service");
const reports_service_1 = require("../reports/reports.service");
const slack_gateway_1 = require("./slack.gateway");
const slack_app_home_view_1 = require("./slack-app-home.view");
const slack_service_1 = require("./slack.service");
let SlackListener = SlackListener_1 = class SlackListener {
    constructor(slackService, slackGateway, collectionService, reportsService) {
        this.slackService = slackService;
        this.slackGateway = slackGateway;
        this.collectionService = collectionService;
        this.reportsService = reportsService;
        this.logger = new common_1.Logger(SlackListener_1.name);
    }
    onModuleInit() {
        this.logger.log('SlackListener onModuleInit() is executing...');
        this.registerListeners();
    }
    registerListeners() {
        this.logger.log('Attempting to register Slack listeners...');
        const app = this.slackService.getSlackApp();
        if (!app) {
            this.logger.error('Slack app is NOT initialized. Listeners CANNOT be registered.');
            return;
        }
        app.event('message', async ({ event }) => {
            var _a, _b;
            const msg = event;
            this.logger.log(`[SLACK EVENT TRIGGERED] message event received: ${JSON.stringify(event)}`);
            if (msg.bot_id ||
                msg.subtype === 'bot_message' ||
                msg.subtype === 'message_changed') {
                this.logger.debug('Ignored bot message or edited message event.');
                return;
            }
            if (!msg.user || !msg.channel) {
                this.logger.warn('Ignored Slack message because user or channel was missing.');
                return;
            }
            this.logger.log(`Processing incoming Slack message from user ${msg.user}`);
            try {
                await this.slackService.ensureUserRegistered(msg.user);
                const payload = {
                    userId: msg.user,
                    channelId: msg.channel,
                    message: (_a = msg.text) !== null && _a !== void 0 ? _a : '',
                    timestamp: (_b = msg.ts) !== null && _b !== void 0 ? _b : '',
                };
                this.logger.log(`Sending incoming message from user ${msg.user} to SlackGateway.`);
                await this.slackGateway.handleIncomingMessage(payload);
            }
            catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : String(error);
                this.logger.error(`Failed to process Slack message for user ${msg.user}: ${message}`, error instanceof Error
                    ? error.stack
                    : undefined);
                await this.slackService.sendMessage({
                    channelId: msg.channel,
                    text: '❌ An error occurred while preparing your standup. ' +
                        'Please try again.',
                });
            }
        });
        app.event('app_mention', async ({ event }) => {
            var _a;
            this.logger.log(`[SLACK EVENT TRIGGERED] app_mention received: ${JSON.stringify(event)}`);
            try {
                await this.slackService.ensureUserRegistered(event.user);
                const normalizedMessage = ((_a = event.text) !== null && _a !== void 0 ? _a : '')
                    .replace(/<@[^>]+>/g, '')
                    .trim();
                const payload = {
                    userId: event.user,
                    channelId: event.channel,
                    message: normalizedMessage,
                    timestamp: event.ts,
                };
                await this.slackGateway.handleIncomingMessage(payload);
            }
            catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : String(error);
                this.logger.error(`Failed to process app mention from user ${event.user}: ${message}`, error instanceof Error
                    ? error.stack
                    : undefined);
                await this.slackService.sendMessage({
                    channelId: event.channel,
                    text: '❌ An error occurred while processing your request.',
                });
            }
        });
        app.event('app_home_opened', async ({ event, client }) => {
            try {
                await this.slackService.ensureUserRegistered(event.user);
                const summary = await this.collectionService.getAppHomeSummary(event.user);
                await client.views.publish({
                    user_id: event.user,
                    view: {
                        type: 'home',
                        blocks: (0, slack_app_home_view_1.buildAppHomeBlocks)(summary),
                    },
                });
            }
            catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : String(error);
                this.logger.error(`Failed to publish App Home: ${message}`, error instanceof Error
                    ? error.stack
                    : undefined);
            }
        });
        app.action('start_standup', async ({ ack, body, client }) => {
            var _a;
            await ack();
            const userId = body.user.id;
            try {
                await this.slackService.ensureUserRegistered(userId);
                const openResult = await client.conversations.open({
                    users: userId,
                });
                const channelId = (_a = openResult.channel) === null || _a === void 0 ? void 0 : _a.id;
                if (!channelId) {
                    this.logger.error('Could not open a DM channel for the standup.');
                    return;
                }
                await this.slackGateway.startConversationFlow(userId, channelId);
                const summary = await this.collectionService.getAppHomeSummary(userId);
                await client.views.publish({
                    user_id: userId,
                    view: {
                        type: 'home',
                        blocks: (0, slack_app_home_view_1.buildAppHomeBlocks)(summary),
                    },
                });
            }
            catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : String(error);
                this.logger.error(`Start standup action failed: ${message}`, error instanceof Error
                    ? error.stack
                    : undefined);
            }
        });
        app.command('/report', async ({ command, ack, respond }) => {
            var _a;
            await ack();
            try {
                await this.slackService.ensureUserRegistered(command.user_id);
                const teamSearch = ((_a = command.text) === null || _a === void 0 ? void 0 : _a.trim()) || undefined;
                const digest = await this.reportsService.getLatestDigestForSlackUser(command.user_id, teamSearch);
                await respond({
                    response_type: 'ephemeral',
                    text: this.reportsService.formatDigestForSlack(digest),
                });
            }
            catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : 'Could not load the latest report.';
                this.logger.error(`/report failed for user ${command.user_id}: ${message}`, error instanceof Error
                    ? error.stack
                    : undefined);
                await respond({
                    response_type: 'ephemeral',
                    text: `❌ ${message}`,
                });
            }
        });
        app.command('/history', async ({ command, ack, respond }) => {
            var _a;
            await ack();
            try {
                await this.slackService.ensureUserRegistered(command.user_id);
                const teamSearch = ((_a = command.text) === null || _a === void 0 ? void 0 : _a.trim()) || undefined;
                const digests = await this.reportsService.getDigestHistoryForSlackUser(command.user_id, 5, teamSearch);
                await respond({
                    response_type: 'ephemeral',
                    text: this.reportsService.formatHistoryForSlack(digests),
                });
            }
            catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : 'Could not load report history.';
                this.logger.error(`/history failed for user ${command.user_id}: ${message}`, error instanceof Error
                    ? error.stack
                    : undefined);
                await respond({
                    response_type: 'ephemeral',
                    text: `❌ ${message}`,
                });
            }
        });
        app.error(async (error) => {
            const message = error instanceof Error
                ? error.message
                : String(error);
            this.logger.error(`[SLACK ERROR] Global error handler caught: ${message}`, error instanceof Error
                ? error.stack
                : undefined);
        });
        this.logger.log('Slack listeners successfully registered.');
    }
};
exports.SlackListener = SlackListener;
exports.SlackListener = SlackListener = SlackListener_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [slack_service_1.SlackService,
        slack_gateway_1.SlackGateway,
        collection_service_1.CollectionService,
        reports_service_1.ReportsService])
], SlackListener);
//# sourceMappingURL=slack.listener.js.map