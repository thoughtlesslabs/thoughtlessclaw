import type { VaultManager, BudgetEntry } from "../vault/index.js";

export type ModelTier = "free" | "cheap" | "standard" | "premium";

export interface ModelConfig {
  name: string;
  tier: ModelTier;
  contextWindow: number;
  pricePerMToken: number;
}

export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  "gpt-4o-mini": {
    name: "GPT-4o Mini",
    tier: "cheap",
    contextWindow: 128000,
    pricePerMToken: 0.15,
  },
  "gpt-4o": {
    name: "GPT-4o",
    tier: "standard",
    contextWindow: 128000,
    pricePerMToken: 2.5,
  },
  "gpt-4-turbo": {
    name: "GPT-4 Turbo",
    tier: "premium",
    contextWindow: 128000,
    pricePerMToken: 10,
  },
  "o1-preview": {
    name: "O1 Preview",
    tier: "premium",
    contextWindow: 128000,
    pricePerMToken: 15,
  },
  "o1-mini": {
    name: "O1 Mini",
    tier: "cheap",
    contextWindow: 128000,
    pricePerMToken: 3,
  },
  "claude-3-haiku": {
    name: "Claude 3 Haiku",
    tier: "free",
    contextWindow: 200000,
    pricePerMToken: 0.2,
  },
  "claude-3-sonnet": {
    name: "Claude 3 Sonnet",
    tier: "standard",
    contextWindow: 200000,
    pricePerMToken: 3,
  },
  "claude-3-opus": {
    name: "Claude 3 Opus",
    tier: "premium",
    contextWindow: 200000,
    pricePerMToken: 15,
  },
};

export class BudgetManager {
  private vault: VaultManager;
  private budgets = new Map<string, BudgetEntry>();
  private throttleUntil = new Map<string, number>();

  constructor(vault: VaultManager) {
    this.vault = vault;
  }

  async loadBudget(agentId: string): Promise<BudgetEntry> {
    const existing = await this.vault.read<BudgetEntry>(`budget/${agentId}.json`);
    if (existing) {
      this.budgets.set(agentId, existing);
      return existing;
    }

    const budget: BudgetEntry = {
      id: `budget-${agentId}`,
      path: `budget/${agentId}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "budget",
      agentId,
      period: "daily",
      tokenLimit: 1000000,
      tokensUsed: 0,
      tokenHistory: [],
      throttleUntil: null,
    };

    await this.vault.write(`budget/${agentId}.json`, budget);
    this.budgets.set(agentId, budget);
    return budget;
  }

  async recordUsage(agentId: string, tokens: number, model: string, taskId: string): Promise<void> {
    let budget = this.budgets.get(agentId);
    if (!budget) {
      budget = await this.loadBudget(agentId);
    }

    budget.tokensUsed += tokens;
    budget.tokenHistory.push({
      timestamp: Date.now(),
      tokens,
      model,
      taskId,
    });

    if (budget.tokenHistory.length > 1000) {
      budget.tokenHistory = budget.tokenHistory.slice(-500);
    }

    await this.vault.write(`budget/${agentId}.json`, budget);

    const usagePercent = (budget.tokensUsed / budget.tokenLimit) * 100;
    if (usagePercent >= 90) {
      this.throttleUntil.set(agentId, Date.now() + 3600000);
      budget.throttleUntil = Date.now() + 3600000;
      await this.vault.write(`budget/${agentId}.json`, budget);
    }
  }

  isThrottled(agentId: string): boolean {
    const throttleTime = this.throttleUntil.get(agentId);
    if (throttleTime && Date.now() < throttleTime) {
      return true;
    }
    this.throttleUntil.delete(agentId);
    return false;
  }

  getThrottleRemaining(agentId: string): number {
    const throttleTime = this.throttleUntil.get(agentId);
    if (!throttleTime) {
      return 0;
    }
    return Math.max(0, throttleTime - Date.now());
  }

  selectModel(taskSize: number, preferredTier?: ModelTier): string {
    if (taskSize < 4000) {
      return "claude-3-haiku";
    }

    if (taskSize < 20000) {
      if (preferredTier === "free") {
        return "claude-3-haiku";
      }
      return "gpt-4o-mini";
    }

    if (taskSize < 100000) {
      if (preferredTier === "premium") {
        return "gpt-4o";
      }
      return "gpt-4o-mini";
    }

    if (taskSize >= 100000 && taskSize <= 200000) {
      return "claude-3-sonnet";
    }

    return "claude-3-opus";
  }

  getUsagePercent(agentId: string): number {
    const budget = this.budgets.get(agentId);
    if (!budget) {
      return 0;
    }
    return (budget.tokensUsed / budget.tokenLimit) * 100;
  }

  async resetDailyBudgets(): Promise<void> {
    for (const [agentId, budget] of this.budgets) {
      budget.tokensUsed = 0;
      budget.tokenHistory = [];
      budget.throttleUntil = null;
      await this.vault.write(`budget/${agentId}.json`, budget);
    }
    this.throttleUntil.clear();
  }
}

export function createBudgetManager(vault: VaultManager): BudgetManager {
  return new BudgetManager(vault);
}
