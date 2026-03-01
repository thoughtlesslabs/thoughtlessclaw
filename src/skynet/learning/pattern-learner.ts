// @ts-nocheck
import { createVaultManager, type VaultManager } from "../vault/manager.js";

const AUTO_APPROVE_THRESHOLD = 80;

export interface PatternEntry {
  id: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
  type: "pattern";
  patternHash: string;
  taskType: string;
  context: string;
  parameters: Record<string, unknown>;
  approvalCount: number;
  rejectionCount: number;
  successCount: number;
  failureCount: number;
  totalOccurrences: number;
  lastApproved: number | null;
  lastRejected: number | null;
  confidence: number;
  autoApproved: boolean;
}

export interface PatternVoteEntry {
  id: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
  type: "pattern_vote";
  patternHash: string;
  voter: "main" | "oversight" | "monitor" | "optimizer";
  vote: "approve" | "reject";
  reason?: string;
  timestamp: number;
}

function hashPattern(taskType: string, context: string, params: Record<string, unknown>): string {
  const keys = Object.keys(params);
  keys.sort();
  const str = `${taskType}:${context}:${JSON.stringify(params, keys)}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export class PatternLearner {
  private vault: VaultManager;

  constructor(vault?: VaultManager) {
    this.vault = vault || createVaultManager("~/.skynet/vault");
  }

  async initialize(): Promise<void> {
    const dirs = ["patterns/approved", "patterns/history"];
    for (const dir of dirs) {
      const fullPath = `~/.skynet/vault/${dir}`;
      await this.vault.write(fullPath + "/.init", {
        initialized: true,
        timestamp: Date.now(),
      } as unknown as Parameters<typeof this.vault.write>[1]);
    }
  }

  async checkAutoApprove(
    taskType: string,
    context: string,
    params: Record<string, unknown>,
  ): Promise<{ shouldAutoApprove: boolean; confidence: number; pattern?: PatternEntry }> {
    const patternHash = hashPattern(taskType, context, params);
    const patternPath = `patterns/approved/${patternHash}.json`;

    const existing = await this.vault.read<PatternEntry>(patternPath);

    if (!existing) {
      return { shouldAutoApprove: false, confidence: 0 };
    }

    const confidence = this.calculateConfidence(existing);

    if (confidence >= AUTO_APPROVE_THRESHOLD) {
      return { shouldAutoApprove: true, confidence, pattern: existing };
    }

    return { shouldAutoApprove: false, confidence, pattern: existing };
  }

  private calculateConfidence(pattern: PatternEntry): number {
    const {
      approvalCount,
      rejectionCount,
      successCount,
      failureCount,
      lastApproved,
      totalOccurrences,
    } = pattern;

    const approvalRate = totalOccurrences > 0 ? (approvalCount / totalOccurrences) * 100 : 0;
    const successRate =
      approvalCount + rejectionCount > 0
        ? (successCount / (successCount + failureCount)) * 100
        : 50;

    let confidence = approvalRate * 0.5 + successRate * 0.3;

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (lastApproved && lastApproved > sevenDaysAgo) {
      confidence += 10;
    }

    if (rejectionCount === 0 && approvalCount > 2) {
      confidence += 10;
    }

    return Math.min(100, confidence);
  }

  async recordApproval(
    patternHash: string,
    taskType: string,
    context: string,
    params: Record<string, unknown>,
    success: boolean,
  ): Promise<void> {
    const patternPath = `patterns/approved/${patternHash}.json`;
    const existing = await this.vault.read<PatternEntry>(patternPath);

    if (existing) {
      existing.approvalCount++;
      existing.totalOccurrences++;
      if (success) {
        existing.successCount++;
      } else {
        existing.failureCount++;
      }
      existing.lastApproved = Date.now();
      existing.confidence = this.calculateConfidence(existing);
      existing.autoApproved = existing.confidence >= AUTO_APPROVE_THRESHOLD;
      existing.updatedAt = Date.now();
      await this.vault.write(patternPath, existing);
    } else {
      const newPattern: PatternEntry = {
        id: `pattern-${patternHash}`,
        path: patternPath,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
        type: "pattern",
        patternHash,
        taskType,
        context,
        parameters: params,
        approvalCount: 1,
        rejectionCount: 0,
        successCount: success ? 1 : 0,
        failureCount: success ? 0 : 1,
        totalOccurrences: 1,
        lastApproved: Date.now(),
        lastRejected: null,
        confidence: this.calculateConfidence({
          approvalCount: 1,
          rejectionCount: 0,
          successCount: success ? 1 : 0,
          failureCount: success ? 0 : 1,
          totalOccurrences: 1,
          lastApproved: Date.now(),
          lastRejected: null,
        } as PatternEntry),
        autoApproved: false,
      };
      await this.vault.write(patternPath, newPattern);
    }

    await this.vault.write(`patterns/history/${patternHash}-${Date.now()}.json`, {
      id: `history-${Date.now()}`,
      path: `patterns/history/${patternHash}-${Date.now()}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "pattern_vote",
      patternHash,
      voter: "system",
      vote: "approve",
      reason: success ? "Task completed successfully" : "Task failed",
      timestamp: Date.now(),
    });
  }

  async recordRejection(
    patternHash: string,
    taskType: string,
    context: string,
    params: Record<string, unknown>,
    reason?: string,
  ): Promise<void> {
    const patternPath = `patterns/approved/${patternHash}.json`;
    const existing = await this.vault.read<PatternEntry>(patternPath);

    if (existing) {
      existing.rejectionCount++;
      existing.totalOccurrences++;
      existing.lastRejected = Date.now();
      existing.confidence = this.calculateConfidence(existing);
      existing.autoApproved = existing.confidence >= AUTO_APPROVE_THRESHOLD;
      existing.updatedAt = Date.now();
      await this.vault.write(patternPath, existing);
    } else {
      const newPattern: PatternEntry = {
        id: `pattern-${patternHash}`,
        path: patternPath,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
        type: "pattern",
        patternHash,
        taskType,
        context,
        parameters: params,
        approvalCount: 0,
        rejectionCount: 1,
        successCount: 0,
        failureCount: 0,
        totalOccurrences: 1,
        lastApproved: null,
        lastRejected: Date.now(),
        confidence: 0,
        autoApproved: false,
      };
      await this.vault.write(patternPath, newPattern);
    }

    await this.vault.write(`patterns/history/${patternHash}-${Date.now()}.json`, {
      id: `history-${Date.now()}`,
      path: `patterns/history/${patternHash}-${Date.now()}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "pattern_vote",
      patternHash,
      voter: "system",
      vote: "reject",
      reason,
      timestamp: Date.now(),
    });
  }

  async getPattern(patternHash: string): Promise<PatternEntry | null> {
    return this.vault.read<PatternEntry>(`patterns/approved/${patternHash}.json`);
  }

  async listPatterns(): Promise<PatternEntry[]> {
    const patterns = await this.vault.list("patterns/approved/");
    const result: PatternEntry[] = [];
    for (const p of patterns) {
      if (p.endsWith(".json") && !p.endsWith(".init")) {
        const pattern = await this.vault.read<PatternEntry>(p);
        if (pattern) {
          result.push(pattern);
        }
      }
    }
    return result;
  }

  async clearPattern(patternHash: string): Promise<void> {
    await this.vault.delete(`patterns/approved/${patternHash}.json`);
  }
}

let patternLearnerInstance: PatternLearner | null = null;

export function getPatternLearner(vault?: VaultManager): PatternLearner {
  if (!patternLearnerInstance) {
    patternLearnerInstance = new PatternLearner(vault);
  }
  return patternLearnerInstance;
}
