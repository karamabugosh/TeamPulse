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
        const updates = responses
            .map((response) => {
            const blockerText = response.blocker
                ? `\nBlocker: ${response.blocker}`
                : '';
            return `*${response.name}*\n${response.update}${blockerText}`;
        })
            .join('\n\n');
        return `*Daily Standup Digest*\n\n${updates}`;
    }
};
exports.DigestService = DigestService;
exports.DigestService = DigestService = __decorate([
    (0, common_1.Injectable)()
], DigestService);
//# sourceMappingURL=digest.service.js.map