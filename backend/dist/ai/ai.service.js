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
var AiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiService = void 0;
const common_1 = require("@nestjs/common");
const pulse_ai_prompts_1 = require("./prompts/pulse-ai.prompts");
const rules_fallback_1 = require("./rules-fallback");
const ai_config_1 = require("./ai.config");
const openai_client_1 = require("./openai-client");
const ai_response_validator_1 = require("./ai-response-validator");
const cost_tracker_1 = require("./cost-tracker");
const prisma_service_1 = require("../prisma/prisma.service");
let AiService = AiService_1 = class AiService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(AiService_1.name);
        this.costAccumulator = new cost_tracker_1.CostAccumulator();
    }
    async analyzeRun(teamId, runId, responses) {
        let result;
        if (!(0, ai_config_1.isAiFeatureEnabled)()) {
            this.logger.log(`AI layer disabled — using rules fallback for run ${runId}`);
            result = (0, rules_fallback_1.runRulesFallback)(teamId, runId, responses);
        }
        else if (responses.length === 0) {
            this.logger.warn(`No responses found for run ${runId}; using rules fallback`);
            result = (0, rules_fallback_1.runRulesFallback)(teamId, runId, responses);
        }
        else {
            try {
                result = await this.runAiExtraction(teamId, runId, responses);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logger.error(`AI extraction failed for run ${runId}, falling back to rules: ${message}`);
                result = (0, rules_fallback_1.runRulesFallback)(teamId, runId, responses);
            }
        }
        await this.saveDigest(result);
        return result;
    }
    async saveDigest(result) {
        try {
            await this.prisma.aiDigest.create({
                data: {
                    teamId: result.teamId,
                    runId: result.runId,
                    generatedAt: new Date(result.generatedAt),
                    source: result.source,
                    summary: result.summary,
                    blockers: result.blockers,
                    themes: result.themes,
                },
            });
            this.logger.log(`Saved AI digest for run ${result.runId} to database`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`Failed to save AI digest for run ${result.runId}: ${message}`);
        }
    }
    getCostSummary() {
        return {
            totalCost: this.costAccumulator.getTotalCost(),
            callCount: this.costAccumulator.getCallCount(),
            averageCostPerCall: this.costAccumulator.getAverageCostPerCall(),
        };
    }
    async runAiExtraction(teamId, runId, responses) {
        const client = (0, openai_client_1.getOpenAiClient)();
        const model = (0, openai_client_1.getOpenAiModel)();
        const userPrompt = pulse_ai_prompts_1.AI_PROMPT.buildUserPrompt(teamId, runId, responses);
        const completion = await client.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: pulse_ai_prompts_1.AI_PROMPT.system },
                { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
        });
        const choice = completion.choices[0];
        if (!choice) {
            throw new Error('OpenAI returned no completion choices');
        }
        if (choice.finish_reason !== 'stop') {
            throw new Error(`OpenAI response did not finish normally: ${choice.finish_reason}`);
        }
        const usage = completion.usage;
        if (usage) {
            const cost = this.costAccumulator.record(model, {
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
            });
            this.logger.debug(`OpenAI usage for run ${runId}: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, total=${usage.total_tokens}` +
                (cost !== null ? `, cost=$${cost.toFixed(6)}` : ''));
        }
        const rawContent = choice.message.content;
        if (!rawContent) {
            throw new Error('OpenAI returned an empty response');
        }
        const parsed = (0, ai_response_validator_1.parseAndValidateAiResponse)(rawContent);
        this.logger.log(`AI analysis completed successfully for run ${runId} using model ${model}`);
        return {
            teamId,
            runId,
            generatedAt: new Date().toISOString(),
            source: 'ai',
            summary: parsed.summary,
            blockers: parsed.blockers,
            themes: parsed.themes,
        };
    }
};
exports.AiService = AiService;
exports.AiService = AiService = AiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AiService);
//# sourceMappingURL=ai.service.js.map