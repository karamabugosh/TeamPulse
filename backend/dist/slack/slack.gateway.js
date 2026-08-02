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
var SlackGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlackGateway = void 0;
const common_1 = require("@nestjs/common");
const slack_service_1 = require("./slack.service");
const collection_service_1 = require("../collection/collection.service");
let SlackGateway = SlackGateway_1 = class SlackGateway {
    constructor(slackService, collectionService) {
        this.slackService = slackService;
        this.collectionService = collectionService;
        this.logger = new common_1.Logger(SlackGateway_1.name);
    }
    async handleIncomingMessage(payload) {
        this.logger.log(`Received message from user ${payload.userId} in channel ${payload.channelId}`);
        try {
            const currentQuestion = await this.collectionService.getCurrentQuestion(payload.userId);
            if (currentQuestion) {
                await this.processAnswer(payload, currentQuestion);
            }
            else {
                if (['start', 'hi', 'hello'].includes(payload.message.trim().toLowerCase())) {
                    await this.startConversationFlow(payload.userId, payload.channelId);
                }
                else {
                    this.logger.debug(`No active conversation for user ${payload.userId}. Message ignored.`);
                    await this.slackService.sendMessage({ channelId: payload.channelId, text: "I'm not sure what you mean. Type `hello` to start a standup." });
                }
            }
        }
        catch (error) {
            this.logger.error(`Error handling incoming message for user ${payload.userId}: ${error.message}`, error.stack);
            await this.slackService.sendMessage({ channelId: payload.channelId, text: "❌ An error occurred processing your request." });
        }
    }
    async startConversationFlow(userId, channelId) {
        this.logger.log(`Starting conversation for user ${userId}`);
        const firstQuestion = await this.collectionService.startConversation(userId);
        if (firstQuestion) {
            await this.slackService.sendMessage({ channelId, text: firstQuestion.text });
        }
        else {
            await this.slackService.sendMessage({ channelId, text: "✅ There are no questions for you right now." });
        }
    }
    async processAnswer(payload, currentQuestion) {
        this.logger.log(`Submitted answer for question ${currentQuestion.questionId} from user ${payload.userId}`);
        try {
            await this.collectionService.submitAnswer(payload.userId, currentQuestion.questionId, payload.message);
        }
        catch (err) {
            await this.slackService.sendMessage({ channelId: payload.channelId, text: `❌ ${err.message}` });
            return;
        }
        const nextQuestion = await this.collectionService.getNextQuestion(payload.userId);
        if (nextQuestion) {
            await this.slackService.sendMessage({ channelId: payload.channelId, text: nextQuestion.text });
        }
        else {
            await this.collectionService.finishConversation(payload.userId);
            await this.slackService.sendMessage({ channelId: payload.channelId, text: "✅ Thank you! Your daily standup has been completed." });
        }
    }
};
exports.SlackGateway = SlackGateway;
exports.SlackGateway = SlackGateway = SlackGateway_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [slack_service_1.SlackService,
        collection_service_1.CollectionService])
], SlackGateway);
//# sourceMappingURL=slack.gateway.js.map