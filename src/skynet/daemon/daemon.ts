import type {
  VaultManager,
  HeartbeatEntry,
  InboxEntry,
  TaskEntry,
  AgentState,
  MemoryEntry,
} from "../vault/index.js";
import type { SkynetConfig } from "./types.js";

export type AgentExecutor = (agentId: string, task: TaskEntry) => Promise<void>;

export class SkynetDaemon {
  private vault: VaultManager;
  private config: SkynetConfig;
  private running = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private inboxWatcher: fs.FSWatcher | null = null;
  private executor: AgentExecutor | null = null;
  private lastActivity = Date.now();

  constructor(vault: VaultManager, config: SkynetConfig) {
    this.vault = vault;
    this.config = config;
  }

  setExecutor(executor: AgentExecutor): void {
    this.executor = executor;
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Daemon already running");
    }

    this.running = true;
    await this.wakeAllAgents();
    this.startHeartbeat();
    this.watchInbox();
    console.log("[Skynet] Daemon started");
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.stopHeartbeat();
    this.stopInboxWatcher();
    await this.sleepAllAgents();
    await this.vault.flush();
    console.log("[Skynet] Daemon stopped");
  }

  private async wakeAllAgents(): Promise<void> {
    const executives = ["main", "oversight", "monitor", "optimizer"];
    for (const agentId of executives) {
      await this.wakeAgent(agentId);
    }
  }

  private async sleepAllAgents(): Promise<void> {
    const executives = ["main", "oversight", "monitor", "optimizer"];
    for (const agentId of executives) {
      await this.sleepAgent(agentId);
    }
  }

  async wakeAgent(agentId: string): Promise<void> {
    const statePath = `agents/${agentId}/state.json`;
    const state = await this.vault.read<AgentState>(statePath);

    if (state) {
      state.status = "awake";
      state.lastWake = Date.now();
      await this.vault.write(statePath, state);
    }

    const memoryPath = `memories/${this.getDateString()}.json`;
    const memory = await this.vault.read<MemoryEntry>(memoryPath);

    if (memory) {
      console.log(`[Skynet] ${agentId} read ${memory.events.length} memory events`);
    }

    console.log(`[Skynet] ${agentId} woke up`);
  }

  async sleepAgent(agentId: string): Promise<void> {
    const statePath = `agents/${agentId}/state.json`;
    const state = await this.vault.read<AgentState>(statePath);

    if (state) {
      state.status = "sleeping";
      state.lastSleep = Date.now();
      await this.vault.write(statePath, state);
    }

    await this.writeHeartbeat(agentId, "sleeping");

    console.log(`[Skynet] ${agentId} went to sleep`);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      await this.runHeartbeat();
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async runHeartbeat(): Promise<void> {
    const executives = ["main", "oversight", "monitor", "optimizer"];
    let hasWork = false;

    const pendingTasks = await this.getPendingTasks();
    const pendingInbox = await this.getPendingInbox();

    if (pendingTasks.length > 0 || pendingInbox.length > 0) {
      hasWork = true;
      this.lastActivity = Date.now();
    }

    const idleTime = Date.now() - this.lastActivity;
    const shouldSleep = idleTime > this.config.idleSleepThresholdMs && !hasWork;

    for (const agentId of executives) {
      const status = shouldSleep ? "sleeping" : "awake";
      await this.writeHeartbeat(agentId, status);

      if (!shouldSleep && this.executor) {
        const tasks = pendingTasks.filter((t) => t.assignee === agentId || t.assignee === null);
        if (tasks.length > 0) {
          const task = tasks[0];
          task.status = "in_progress";
          task.startedAt = Date.now();
          await this.vault.write(`tasks/${task.id}.json`, task);
          await this.updateAgentState(agentId, "working", task.id);

          try {
            await this.executor(agentId, task);
            task.status = "completed";
            task.completedAt = Date.now();
          } catch (err) {
            task.status = "failed";
            console.error(`[Skynet] Task ${task.id} failed:`, err);
          }

          await this.vault.write(`tasks/${task.id}.json`, task);
          await this.updateAgentState(agentId, "awake", null);
        }
      }
    }

    if (shouldSleep) {
      console.log(`[Skynet] Idle for ${Math.round(idleTime / 1000)}s, entering sleep mode`);
    }
  }

  private async writeHeartbeat(agentId: string, status: HeartbeatEntry["status"]): Promise<void> {
    const heartbeat: HeartbeatEntry = {
      id: `${agentId}-${Date.now()}`,
      path: `heartbeats/${agentId}-${Date.now()}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "heartbeat",
      agentId,
      status,
      timestamp: Date.now(),
      metrics: {
        tokensUsed: 0,
        tokensBudget: this.config.defaultTokenBudget,
        contextUsagePercent: 0,
        activeAgents: 4,
        uptime: process.uptime(),
        errors: 0,
      },
      pendingTasks: [],
      lastTask: null,
    };

    const path = `heartbeats/${agentId}-${Date.now()}.json`;
    await this.vault.write(path, heartbeat);
  }

  private async getPendingTasks(): Promise<TaskEntry[]> {
    const files = await this.vault.list("tasks", "\\.json$");
    const tasks: TaskEntry[] = [];

    for (const file of files) {
      const task = await this.vault.read<TaskEntry>(`tasks/${file}`);
      if (task && (task.status === "queued" || task.status === "assigned")) {
        tasks.push(task);
      }
    }

    return tasks.toSorted((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  private async getPendingInbox(): Promise<InboxEntry[]> {
    const files = await this.vault.list("inbox", "\\.json$");
    const inbox: InboxEntry[] = [];

    for (const file of files) {
      const entry = await this.vault.read<InboxEntry>(`inbox/${file}`);
      if (entry && entry.status === "pending") {
        inbox.push(entry);
      }
    }

    return inbox;
  }

  private async updateAgentState(
    agentId: string,
    status: AgentState["status"],
    currentTaskId: string | null,
  ): Promise<void> {
    const statePath = `agents/${agentId}/state.json`;
    const state = await this.vault.read<AgentState>(statePath);

    if (state) {
      state.status = status;
      state.currentTaskId = currentTaskId;
      await this.vault.write(statePath, state);
    }
  }

  private watchInbox(): void {
    const inboxPath = this.vault.getBasePath() + "/inbox";

    this.inboxWatcher = fs.watch(inboxPath, async (eventType, filename) => {
      if (eventType === "rename" && filename?.endsWith(".json")) {
        this.lastActivity = Date.now();
        console.log(`[Skynet] New inbox item: ${filename}`);

        const entry = await this.vault.read<InboxEntry>(`inbox/${filename}`);
        if (entry && entry.status === "pending") {
          await this.processInboxEntry(entry);
        }
      }
    });
  }

  private stopInboxWatcher(): void {
    if (this.inboxWatcher) {
      this.inboxWatcher.close();
      this.inboxWatcher = null;
    }
  }

  private async processInboxEntry(entry: InboxEntry): Promise<void> {
    if (entry.requiresApproval) {
      console.log(`[Skynet] Inbox entry ${entry.id} requires approval`);
      return;
    }

    const task: TaskEntry = {
      id: entry.id,
      path: `tasks/${entry.id}.json`,
      createdAt: entry.createdAt,
      updatedAt: Date.now(),
      metadata: {},
      type: "task",
      title: entry.request,
      description: entry.context,
      status: "queued",
      priority: entry.priority,
      assignee: null,
      tier: 1,
      parentTaskId: null,
      subtasks: [],
      dependencies: [],
      createdBy: entry.from,
      assignedAt: null,
      startedAt: null,
      completedAt: null,
      artifacts: [],
      doneMarker: false,
      doneMessage: null,
    };

    await this.vault.write(`tasks/${entry.id}.json`, task);

    entry.status = "in_progress";
    await this.vault.write(`inbox/${entry.id}.json`, entry);
  }

  private getDateString(): string {
    return new Date().toISOString().split("T")[0];
  }

  isRunning(): boolean {
    return this.running;
  }
}

import fs from "node:fs";
