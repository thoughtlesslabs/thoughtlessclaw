import type { VaultManager } from "../vault/index.js";

export interface ContextMetrics {
  agentId: string;
  currentTokens: number;
  maxTokens: number;
  usagePercent: number;
  status: "safe" | "warning" | "critical";
}

export interface ContextPressureConfig {
  warningThreshold: number;
  criticalThreshold: number;
  compactionTriggerPercent: number;
}

export const DEFAULT_CONTEXT_PRESSURE_CONFIG: ContextPressureConfig = {
  warningThreshold: 60,
  criticalThreshold: 75,
  compactionTriggerPercent: 75,
};

export class ContextPressureMonitor {
  private vault: VaultManager;
  private config: ContextPressureConfig;
  private lastCompaction = new Map<string, number>();

  constructor(vault: VaultManager, config: Partial<ContextPressureConfig> = {}) {
    this.vault = vault;
    this.config = { ...DEFAULT_CONTEXT_PRESSURE_CONFIG, ...config };
  }

  async checkContextPressure(
    agentId: string,
    currentTokens: number,
    maxTokens: number,
  ): Promise<ContextMetrics> {
    const usagePercent = (currentTokens / maxTokens) * 100;

    let status: "safe" | "warning" | "critical" = "safe";
    if (usagePercent >= this.config.criticalThreshold) {
      status = "critical";
    } else if (usagePercent >= this.config.warningThreshold) {
      status = "warning";
    }

    return {
      agentId,
      currentTokens,
      maxTokens,
      usagePercent,
      status,
    };
  }

  async shouldCompact(agentId: string, currentTokens: number, maxTokens: number): Promise<boolean> {
    const usagePercent = (currentTokens / maxTokens) * 100;
    const lastCompact = this.lastCompaction.get(agentId) || 0;
    const timeSinceLastCompact = Date.now() - lastCompact;

    const MIN_COMPACTION_INTERVAL = 300000;

    if (
      usagePercent >= this.config.compactionTriggerPercent &&
      timeSinceLastCompact > MIN_COMPACTION_INTERVAL
    ) {
      this.lastCompaction.set(agentId, Date.now());
      return true;
    }

    return false;
  }

  async logPressure(agentId: string, _metrics: ContextMetrics): Promise<void> {
    const heartbeatFiles = await this.vault.list("heartbeats", `${agentId}-.*\\.json$`);

    if (heartbeatFiles.length > 10) {
      const oldest = heartbeatFiles.slice(0, heartbeatFiles.length - 10);
      for (const file of oldest) {
        await this.vault.delete(`heartbeats/${file}`);
      }
    }
  }

  getConfig(): ContextPressureConfig {
    return { ...this.config };
  }

  setThresholds(warning: number, critical: number): void {
    this.config.warningThreshold = warning;
    this.config.criticalThreshold = critical;
  }
}

export function createContextPressureMonitor(
  vault: VaultManager,
  config?: Partial<ContextPressureConfig>,
): ContextPressureMonitor {
  return new ContextPressureMonitor(vault, config);
}
