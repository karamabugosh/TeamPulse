// backend/src/ai/cost-tracker.ts

const PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export function calculateCallCost(model: string, usage: TokenUsage): number | null {
  const pricing = PRICING_PER_MILLION_TOKENS[model];
  if (!pricing) return null;

  const inputCost = (usage.promptTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.output;

  return inputCost + outputCost;
}

export class CostAccumulator {
  private totalCost = 0;
  private callCount = 0;

  record(model: string, usage: TokenUsage): number | null {
    const cost = calculateCallCost(model, usage);
    if (cost !== null) {
      this.totalCost += cost;
      this.callCount += 1;
    }
    return cost;
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  getAverageCostPerCall(): number | null {
    if (this.callCount === 0) return null;
    return this.totalCost / this.callCount;
  }

  getCallCount(): number {
    return this.callCount;
  }
}