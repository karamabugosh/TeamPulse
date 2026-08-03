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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let ReportsService = class ReportsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getLatestDigestForSlackUser(slackUserId, teamSearch) {
        const user = await this.prisma.user.findUnique({
            where: { slackUserId },
            include: {
                teamMembers: {
                    include: {
                        team: true,
                    },
                },
            },
        });
        if (!user) {
            throw new common_1.NotFoundException('User is not registered.');
        }
        if (user.teamMembers.length === 0) {
            throw new common_1.NotFoundException('You are not assigned to any team.');
        }
        const selectedMembership = teamSearch
            ? user.teamMembers.find((membership) => {
                const search = teamSearch.trim().toLowerCase();
                return (membership.team.id.toLowerCase() === search ||
                    membership.team.name.toLowerCase() === search);
            })
            : user.teamMembers[0];
        if (!selectedMembership) {
            throw new common_1.NotFoundException(`No team matching "${teamSearch}" was found.`);
        }
        const digest = await this.prisma.aiDigest.findFirst({
            where: {
                teamId: selectedMembership.teamId,
            },
            orderBy: {
                generatedAt: 'desc',
            },
        });
        if (!digest) {
            throw new common_1.NotFoundException(`No reports exist yet for ${selectedMembership.team.name}.`);
        }
        return this.mapDigest(digest);
    }
    async getDigestHistoryForSlackUser(slackUserId, limit = 5, teamSearch) {
        const user = await this.prisma.user.findUnique({
            where: { slackUserId },
            include: {
                teamMembers: {
                    include: {
                        team: true,
                    },
                },
            },
        });
        if (!user) {
            throw new common_1.NotFoundException('User is not registered.');
        }
        if (user.teamMembers.length === 0) {
            throw new common_1.NotFoundException('You are not assigned to any team.');
        }
        const selectedMembership = teamSearch
            ? user.teamMembers.find((membership) => {
                const search = teamSearch.trim().toLowerCase();
                return (membership.team.id.toLowerCase() === search ||
                    membership.team.name.toLowerCase() === search);
            })
            : user.teamMembers[0];
        if (!selectedMembership) {
            throw new common_1.NotFoundException(`No team matching "${teamSearch}" was found.`);
        }
        const safeLimit = Math.min(Math.max(limit, 1), 10);
        const digests = await this.prisma.aiDigest.findMany({
            where: {
                teamId: selectedMembership.teamId,
            },
            orderBy: {
                generatedAt: 'desc',
            },
            take: safeLimit,
        });
        return digests.map((digest) => this.mapDigest(digest));
    }
    formatDigestForSlack(digest) {
        const blockerText = digest.blockers.length > 0
            ? digest.blockers
                .map((blocker) => `• <@${blocker.userId}> — ${blocker.description}` +
                `\n  Severity: ${blocker.severity}` +
                (blocker.dependency
                    ? ` | Dependency: ${blocker.dependency}`
                    : ''))
                .join('\n')
            : 'No blockers reported.';
        const themeText = digest.themes.length > 0
            ? digest.themes
                .map((theme) => `• *${theme.theme}* (${theme.mentionCount}) — ${theme.summary}`)
                .join('\n')
            : 'No common themes reported.';
        return [
            '*📊 Pulse Standup Report*',
            `*Run:* ${digest.runId}`,
            `*Generated:* ${this.formatDate(digest.generatedAt)}`,
            `*Source:* ${digest.source}`,
            '',
            '*Summary*',
            digest.summary,
            '',
            '*Blockers*',
            blockerText,
            '',
            '*Themes*',
            themeText,
        ].join('\n');
    }
    formatHistoryForSlack(digests) {
        if (digests.length === 0) {
            return '📭 No previous reports were found.';
        }
        const reportLines = digests.map((digest, index) => {
            const summary = this.truncate(digest.summary, 180);
            return [
                `*${index + 1}. ${this.formatDate(digest.generatedAt)}*`,
                `Run: \`${digest.runId}\` | Source: ${digest.source}`,
                summary,
            ].join('\n');
        });
        return [
            '*🕘 Pulse Report History*',
            '',
            ...reportLines.map((line) => `${line}\n`),
        ].join('\n');
    }
    generateCsvFromDigest(digest) {
        var _a, _b, _c, _d, _e;
        const blockers = (_a = digest.blockers) !== null && _a !== void 0 ? _a : [];
        const themes = (_b = digest.themes) !== null && _b !== void 0 ? _b : [];
        const lines = [];
        lines.push('Team ID,Run ID,Generated At,Source,Summary');
        lines.push([
            this.escapeCsvField(digest.teamId),
            this.escapeCsvField(digest.runId),
            this.escapeCsvField(digest.generatedAt),
            this.escapeCsvField(digest.source),
            this.escapeCsvField(digest.summary),
        ].join(','));
        lines.push('');
        lines.push('Blockers');
        lines.push('User ID,Question ID,Description,Severity,Dependency,Confidence');
        if (blockers.length === 0) {
            lines.push('No blockers reported');
        }
        else {
            for (const blocker of blockers) {
                lines.push([
                    this.escapeCsvField(blocker.userId),
                    this.escapeCsvField(blocker.questionId),
                    this.escapeCsvField(blocker.description),
                    this.escapeCsvField(blocker.severity),
                    this.escapeCsvField((_c = blocker.dependency) !== null && _c !== void 0 ? _c : ''),
                    String((_d = blocker.confidence) !== null && _d !== void 0 ? _d : ''),
                ].join(','));
            }
        }
        lines.push('');
        lines.push('Themes');
        lines.push('Theme,Mention Count,Summary');
        if (themes.length === 0) {
            lines.push('No themes reported');
        }
        else {
            for (const theme of themes) {
                lines.push([
                    this.escapeCsvField(theme.theme),
                    String((_e = theme.mentionCount) !== null && _e !== void 0 ? _e : ''),
                    this.escapeCsvField(theme.summary),
                ].join(','));
            }
        }
        return lines.join('\r\n');
    }
    mapDigest(digest) {
        const source = digest.source === 'ai' ? 'ai' : 'rules_fallback';
        return {
            teamId: digest.teamId,
            runId: digest.runId,
            generatedAt: digest.generatedAt.toISOString(),
            source,
            summary: digest.summary,
            blockers: Array.isArray(digest.blockers)
                ? digest.blockers
                : [],
            themes: Array.isArray(digest.themes)
                ? digest.themes
                : [],
        };
    }
    formatDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        return date.toLocaleString('en-GB', {
            dateStyle: 'medium',
            timeStyle: 'short',
        });
    }
    truncate(value, maxLength) {
        if (value.length <= maxLength) {
            return value;
        }
        return `${value.slice(0, maxLength - 3)}...`;
    }
    escapeCsvField(value) {
        const text = value !== null && value !== void 0 ? value : '';
        if (text.includes(',') ||
            text.includes('"') ||
            text.includes('\n') ||
            text.includes('\r')) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    }
};
exports.ReportsService = ReportsService;
exports.ReportsService = ReportsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ReportsService);
//# sourceMappingURL=reports.service.js.map