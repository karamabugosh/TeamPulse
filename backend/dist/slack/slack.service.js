"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SlackService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlackService = void 0;
const common_1 = require("@nestjs/common");
const web_api_1 = require("@slack/web-api");
let SlackService = SlackService_1 = class SlackService {
    constructor() {
        this.logger = new common_1.Logger(SlackService_1.name);
    }
    async sendMessage(botToken, channelId, text) {
        const client = new web_api_1.WebClient(botToken);
        await client.chat.postMessage({
            channel: channelId,
            text,
        });
        this.logger.log(`Message sent to Slack channel ${channelId}`);
    }
};
exports.SlackService = SlackService;
exports.SlackService = SlackService = SlackService_1 = __decorate([
    (0, common_1.Injectable)()
], SlackService);
//# sourceMappingURL=slack.service.js.map