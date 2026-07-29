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
const slack_service_1 = require("./slack.service");
const slack_gateway_1 = require("./slack.gateway");
const collection_service_1 = require("../collection/collection.service");
const slack_app_home_view_1 = require("./slack-app-home.view");
let SlackListener = SlackListener_1 = class SlackListener {
    constructor(slackService, slackGateway, collectionService) {
        this.slackService = slackService;
        this.slackGateway = slackGateway;
        this.collectionService = collectionService;
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
        app.event('message', async ({ event, say }) => {
            this.logger.log(`[SLACK EVENT TRIGGERED] app.event('message') hit! Raw event: ${JSON.stringify(event)}`);
            const msg = event;
            if (msg.bot_id || msg.subtype === 'bot_message' || msg.subtype === 'message_changed') {
                this.logger.debug('Ignored bot message or edit event.');
                return;
            }
            this.logger.log(`Processing incoming Slack message from user ${msg.user}`);
            const payload = {
                userId: msg.user,
                channelId: msg.channel,
                message: msg.text || '',
                timestamp: msg.ts,
            };
            this.logger.log(`Payload prepared, sending to SlackGateway...`);
            await this.slackGateway.handleIncomingMessage(payload);
        });
        app.event('app_mention', async ({ event, say }) => {
            this.logger.log(`[SLACK EVENT TRIGGERED] app_mention hit! Event: ${JSON.stringify(event)}`);
        });
        app.event('app_home_opened', async ({ event, client }) => {
            try {
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
                this.logger.error(`Failed to publish App Home: ${error.message}`, error.stack);
            }
        });
        app.action('start_standup', async ({ ack, body, client }) => {
            var _a;
            await ack();
            const userId = body.user.id;
            try {
                const open = await client.conversations.open({ users: userId });
                const channelId = (_a = open.channel) === null || _a === void 0 ? void 0 : _a.id;
                if (!channelId) {
                    this.logger.error('Could not open DM channel for standup start.');
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
                this.logger.error(`Start standup action failed: ${error.message}`, error.stack);
            }
        });
        app.error(async (error) => {
            this.logger.error(`[SLACK ERROR] Global error handler caught: ${error.message}`, error);
        });
        this.logger.log('Slack listeners successfully registered.');
    }
};
exports.SlackListener = SlackListener;
exports.SlackListener = SlackListener = SlackListener_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [slack_service_1.SlackService,
        slack_gateway_1.SlackGateway,
        collection_service_1.CollectionService])
], SlackListener);
//# sourceMappingURL=slack.listener.js.map