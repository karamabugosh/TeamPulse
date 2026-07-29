"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DigestService = void 0;
const common_1 = require("@nestjs/common");
let DigestService = class DigestService {
    generateDailyDigest(responses) {
        if (responses.length === 0) {
            return '*Daily Standup Digest*\n\nNo updates were submitted.';
        }
        const updates = responses
            .map((response) => `*${response.name}*\n${response.update}`)
            .join('\n\n');
        const blockers = responses
            .filter((response) => response.blocker)
            .map((response) => `• *${response.name}:* ${response.blocker}`)
            .join('\n');
        const blockerSection = blockers
            ? `\n\n*Blockers*\n${blockers}`
            : '\n\n*Blockers*\nNone reported.';
        return `*Daily Standup Digest*\n\n${updates}${blockerSection}`;
    }
};
exports.DigestService = DigestService;
exports.DigestService = DigestService = __decorate([
    (0, common_1.Injectable)()
], DigestService);
//# sourceMappingURL=digest.service.js.map