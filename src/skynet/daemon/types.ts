import type { TaskEntry } from "../vault/index.js";

export type AgentExecutor = (agentId: string, task: TaskEntry) => Promise<void>;

export interface SkynetConfig {
  vaultPath: string;
  heartbeatIntervalMs: number;
  idleSleepThresholdMs: number;
  contextThresholdPercent: number;
  defaultTokenBudget: number;
  violationPenalty: number;
  rewardStartingPoints: number;
  triadThreshold: number;
}

export const DEFAULT_SKYNET_CONFIG: SkynetConfig = {
  vaultPath: "~/.skynet/vault",
  heartbeatIntervalMs: 60000,
  idleSleepThresholdMs: 300000,
  contextThresholdPercent: 75,
  defaultTokenBudget: 1000000,
  violationPenalty: 10,
  rewardStartingPoints: 100,
  triadThreshold: 0.66,
};
