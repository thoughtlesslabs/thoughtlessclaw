// @ts-nocheck
import { createVaultManager, type VaultManager } from "../vault/manager.js";

export interface PriorityEntry {
  id: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
  type: "priority";
  title: string;
  description: string;
  submittedBy: "main" | "oversight" | "monitor" | "optimizer" | "system" | "worker";
  category: "task" | "idea" | "improvement" | "safety" | "urgent";
  baseScore: number;
  votes: Record<string, number>;
  submittedAt: number;
  lastVotedAt: number | null;
  resolvedAt: number | null;
  resolved: boolean;
  tags: string[];
}

export interface PriorityVoteEntry {
  id: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
  type: "priority_vote";
  priorityId: string;
  voter: "main" | "oversight" | "monitor" | "optimizer";
  score: number;
  reason?: string;
  timestamp: number;
}

const DECAY_FACTOR = 0.1;

export class PriorityBoard {
  private vault: VaultManager;

  constructor(vault?: VaultManager) {
    this.vault = vault || createVaultManager("~/.skynet/vault");
  }

  async initialize(): Promise<void> {
    await this.vault.write("priorities/.init", { initialized: true, timestamp: Date.now() });
  }

  async submitPriority(
    title: string,
    description: string,
    submittedBy: PriorityEntry["submittedBy"],
    category: PriorityEntry["category"],
    baseScore: number = 50,
    tags: string[] = [],
  ): Promise<string> {
    const id = `priority-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const priority: PriorityEntry = {
      id,
      path: `priorities/active/${id}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "priority",
      title,
      description,
      submittedBy,
      category,
      baseScore,
      votes: {},
      submittedAt: Date.now(),
      lastVotedAt: null,
      resolvedAt: null,
      resolved: false,
      tags,
    };
    await this.vault.write(`priorities/active/${id}.json`, priority);
    return id;
  }

  async vote(
    priorityId: string,
    voter: PriorityVoteEntry["voter"],
    score: number,
    reason?: string,
  ): Promise<void> {
    const priority = await this.vault.read<PriorityEntry>(`priorities/active/${priorityId}.json`);
    if (!priority || priority.resolved) {
      return;
    }

    priority.votes[voter] = score;
    priority.lastVotedAt = Date.now();
    priority.updatedAt = Date.now();
    await this.vault.write(`priorities/active/${priorityId}.json`, priority);

    await this.vault.write(`priorities/votes/${priorityId}-${voter}-${Date.now()}.json`, {
      id: `vote-${priorityId}-${voter}-${Date.now()}`,
      path: `priorities/votes/${priorityId}-${voter}-${Date.now()}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "priority_vote",
      priorityId,
      voter,
      score,
      reason,
      timestamp: Date.now(),
    });
  }

  async getPriorities(
    limit: number = 10,
  ): Promise<Array<{ priority: PriorityEntry; score: number }>> {
    const priorities = await this.vault.list("priorities/active/");
    const result: Array<{ priority: PriorityEntry; score: number }> = [];

    for (const p of priorities) {
      if (!p.endsWith(".json") || p.endsWith(".init")) {
        continue;
      }
      const priority = await this.vault.read<PriorityEntry>(`priorities/active/${p}`);
      if (priority && !priority.resolved) {
        const score = this.calculateScore(priority);
        result.push({ priority, score });
      }
    }

    result.sort((a, b) => b.score - a.score);
    return result.slice(0, limit);
  }

  private calculateScore(priority: PriorityEntry): number {
    let score = priority.baseScore;

    const executiveVotes = Object.values(priority.votes).reduce((a, b) => a + b, 0);
    score += executiveVotes * 10;

    const hoursSinceSubmitted = (Date.now() - priority.submittedAt) / (1000 * 60 * 60);
    score -= hoursSinceSubmitted * DECAY_FACTOR;

    if (priority.category === "urgent") {
      score += 20;
    }
    if (priority.category === "safety") {
      score += 15;
    }
    if (priority.category === "improvement") {
      score += 5;
    }

    const safetyTags = priority.tags.filter((t) => t.includes("safety") || t.includes("critical"));
    score += safetyTags.length * 10;

    return Math.max(0, score);
  }

  async resolvePriority(priorityId: string): Promise<void> {
    const priority = await this.vault.read<PriorityEntry>(`priorities/active/${priorityId}.json`);
    if (!priority) {
      return;
    }

    priority.resolved = true;
    priority.resolvedAt = Date.now();
    priority.updatedAt = Date.now();

    await this.vault.write(`priorities/active/${priorityId}.json`, priority);
    await this.vault.write(`priorities/history/${priorityId}.json`, priority);
  }

  async runExecutiveRanking(): Promise<Array<{ priority: PriorityEntry; score: number }>> {
    return this.getPriorities(10);
  }

  async getCategoryPriorities(
    category: PriorityEntry["category"],
  ): Promise<Array<{ priority: PriorityEntry; score: number }>> {
    const all = await this.getPriorities(100);
    return all.filter((p) => p.priority.category === category);
  }

  async getUrgentPriorities(): Promise<Array<{ priority: PriorityEntry; score: number }>> {
    const all = await this.getPriorities(100);
    return all.filter((p) => p.priority.category === "urgent" || p.score > 80);
  }
}

let priorityBoardInstance: PriorityBoard | null = null;

export function getPriorityBoard(vault?: VaultManager): PriorityBoard {
  if (!priorityBoardInstance) {
    priorityBoardInstance = new PriorityBoard(vault);
  }
  return priorityBoardInstance;
}
